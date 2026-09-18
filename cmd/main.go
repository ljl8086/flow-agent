package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Command struct {
	ID     string         `json:"id"`
	Method string         `json:"method"`
	Params map[string]any `json:"params"`
}

type Callback struct {
	ID        string         `json:"id"`
	SessionID string         `json:"session_id,omitempty"`
	Status    int            `json:"status"`
	Result    map[string]any `json:"result,omitempty"`
	Error     string         `json:"error,omitempty"`
}

type BridgeServer struct {
	mu       sync.RWMutex
	upgrader websocket.Upgrader
	conn     *websocket.Conn
	pending  map[string]chan *Callback
}

func NewBridgeServer() *BridgeServer {
	return &BridgeServer{
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		pending: make(map[string]chan *Callback),
	}
}

func (s *BridgeServer) randomID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *BridgeServer) handleWS(w http.ResponseWriter, r *http.Request) {
	c, err := s.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Bridge] WS upgrade failed: %v", err)
		return
	}
	defer c.Close()

	s.mu.Lock()
	if s.conn != nil {
		_ = s.conn.Close()
	}
	s.conn = c
	s.mu.Unlock()
	log.Printf("[Bridge] Chrome extension connected over WebSocket")

	for {
		var raw map[string]any
		if err := c.ReadJSON(&raw); err != nil {
			log.Printf("[Bridge] WS Read error: %v", err)
			break
		}
		log.Printf("[Bridge] WS Received message: %v", raw)
		reqID, _ := raw["id"].(string)
		if reqID != "" {
			s.mu.RLock()
			ch, ok := s.pending[reqID]
			s.mu.RUnlock()
			if ok {
				data, _ := json.Marshal(raw)
				var cb Callback
				_ = json.Unmarshal(data, &cb)
				select {
				case ch <- &cb:
				default:
				}
			}
		}
	}

	s.mu.Lock()
	if s.conn == c {
		s.conn = nil
	}
	s.mu.Unlock()
	log.Printf("[Bridge] Extension connection closed")
}

func (s *BridgeServer) SendCommand(ctx context.Context, method string, params map[string]any) (*Callback, error) {
	cmdID := s.randomID()
	cmd := Command{
		ID:     cmdID,
		Method: method,
		Params: params,
	}

	ch := make(chan *Callback, 1)
	s.mu.Lock()
	if s.conn == nil {
		s.mu.Unlock()
		return nil, fmt.Errorf("no active Chrome extension connected")
	}
	s.pending[cmdID] = ch
	conn := s.conn
	s.mu.Unlock()

	defer func() {
		s.mu.Lock()
		delete(s.pending, cmdID)
		s.mu.Unlock()
	}()

	if err := conn.WriteJSON(cmd); err != nil {
		return nil, fmt.Errorf("send command error: %w", err)
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case cb := <-ch:
		if cb.Error != "" {
			return nil, fmt.Errorf("extension error: %s", cb.Error)
		}
		return cb, nil
	}
}

func (s *BridgeServer) handleDispatchPrompt(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	var req struct {
		Prompt     string `json:"prompt"`
		AutoSubmit bool   `json:"auto_submit"`
		ShotID     string `json:"shot_id"`
		Mode       string `json:"mode"`
		Agent      bool   `json:"agent"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	cb, err := s.SendCommand(ctx, "inject_prompt", map[string]any{
		"prompt":      req.Prompt,
		"auto_submit": req.AutoSubmit,
		"shot_id":     req.ShotID,
		"mode":        req.Mode,
		"agent":       req.Agent,
	})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"status": cb.Status,
		"result": cb.Result,
	})
}

func (s *BridgeServer) handleDownload(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	var req struct {
		URL      string `json:"url"`
		Filename string `json:"filename"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}
	if strings.TrimSpace(req.URL) == "" {
		http.Error(w, `{"error":"url is required"}`, http.StatusBadRequest)
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 15*time.Second)
	defer cancel()

	cb, err := s.SendCommand(ctx, "download_media", map[string]any{
		"url":      req.URL,
		"filename": req.Filename,
	})
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"status": cb.Status,
		"result": cb.Result,
	})
}

func (s *BridgeServer) handleScanMedia(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
	defer cancel()

	cb, err := s.SendCommand(ctx, "scan_canvas", nil)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadGateway)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"ok":     true,
		"status": cb.Status,
		"result": cb.Result,
	})
}

func (s *BridgeServer) handleHealth(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	connected := s.conn != nil
	s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{
		"product":             "flow-agent",
		"status":              "healthy",
		"extension_connected": connected,
		"version":             "1.0.0",
	})
}

func (s *BridgeServer) handleExtCallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	if r.Method == http.MethodOptions {
		return
	}

	var cb Callback
	if err := json.NewDecoder(r.Body).Decode(&cb); err != nil {
		http.Error(w, `{"error":"invalid JSON"}`, http.StatusBadRequest)
		return
	}

	if cb.ID != "" {
		s.mu.RLock()
		ch, ok := s.pending[cb.ID]
		s.mu.RUnlock()
		if ok {
			select {
			case ch <- &cb:
			default:
			}
		}
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]any{"ok": true})
}

func main() {
	port := flag.Int("port", 8001, "Port to listen on")
	host := flag.String("host", "127.0.0.1", "Host interface")
	flag.Parse()

	server := NewBridgeServer()
	mux := http.NewServeMux()
	mux.HandleFunc("/ws", server.handleWS)
	mux.HandleFunc("/health", server.handleHealth)
	mux.HandleFunc("/v1/status", server.handleHealth)
	mux.HandleFunc("/api/ext/callback", server.handleExtCallback)
	mux.HandleFunc("/v1/dispatch_prompt", server.handleDispatchPrompt)
	mux.HandleFunc("/v1/download_media", server.handleDownload)
	mux.HandleFunc("/v1/scan_media", server.handleScanMedia)

	addr := fmt.Sprintf("%s:%d", *host, *port)
	log.Printf("=====================================================")
	log.Printf(" Flow Agent Bridge Daemon running at http://%s", addr)
	log.Printf(" Extension source: extension/")
	log.Printf("=====================================================")

	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}
