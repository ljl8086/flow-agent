#!/usr/bin/env python3
"""
Flow Agent Pipeline - Multi-modal Storyboard Dispatcher & Asset Downloader
Part of Flow Agent Engine. Copyright (c) 2026 ljl8086. Licensed under MIT.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.request
from pathlib import Path
from typing import Any, Dict, Optional

DEFAULT_BRIDGE_URL = "http://127.0.0.1:8001"


def check_compliance(prompt: str) -> list[str]:
    """Safety and compliance validator for video/image generation prompts."""
    warnings = []
    minor_terms = ["幼童", "小孩", "六岁", "男童", "女童", "光脚", "赤足", "裸露小腿"]
    distress_terms = ["溺水", "受惊", "颤抖", "惨叫", "爆开", "淹没", "伤害"]
    for m in minor_terms:
        if m in prompt:
            for d in distress_terms:
                if d in prompt:
                    warnings.append(f"安全合规预警：检测到未成年人词汇「{m}」与遇险动作「{d}」并存，请确认安全边界。")

    if "台词" in prompt and "无台词" not in prompt and "无人物说话" not in prompt:
        warnings.append("视听规程提示：建议显式声明「无台词念白与说话声」，避免模型生成杂音口型。")
    return warnings


def format_agent_instruction(prompt: str, mode: str = "image", shot_id: str = "V01") -> str:
    """Format raw prompt into Title: VXX。[...] convention for Google Flow Agent and Card naming."""
    clean_prompt = prompt.strip()
    # If prompt already follows the Title: VXX。[...] syntax, respect it directly
    if clean_prompt.startswith("Title:"):
        return clean_prompt

    # Strip existing outer brackets if any
    if clean_prompt.startswith("[") and clean_prompt.endswith("]"):
        inner_content = clean_prompt[1:-1].strip()
    else:
        inner_content = clean_prompt

    # Standard Google Flow Card Naming & Agent Prompt Syntax
    return f"Title: {shot_id}。[{inner_content}]"


def dispatch_prompt(
    prompt: str,
    shot_id: str = "V01",
    mode: str = "image",
    agent: bool = False,
    auto_submit: bool = True,
    bridge_url: str = DEFAULT_BRIDGE_URL
) -> Dict[str, Any]:
    """Dispatch prompt directly into Google Flow active tab via Flow Agent Daemon."""
    warnings = check_compliance(prompt)
    final_prompt = format_agent_instruction(prompt, mode, shot_id) if agent else prompt

    payload = json.dumps({
        "prompt": final_prompt,
        "auto_submit": auto_submit,
        "shot_id": shot_id,
        "mode": mode,
        "agent": agent
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{bridge_url}/v1/dispatch_prompt",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            data["warnings"] = warnings
            data["agent_mode"] = agent
            return data
    except Exception as e:
        return {"ok": False, "error": str(e), "warnings": warnings}


def download_asset(media_url: str, filename: str, bridge_url: str = DEFAULT_BRIDGE_URL) -> Dict[str, Any]:
    """Request browser extension to download media URL with standardized naming."""
    payload = json.dumps({
        "url": media_url,
        "filename": filename
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{bridge_url}/v1/download_media",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok": False, "error": str(e)}


def main():
    parser = argparse.ArgumentParser(description="Flow Agent Storyboard Dispatcher")
    parser.add_argument("--shot-id", default="V01", help="Shot ID, e.g. V01 / S01")
    parser.add_argument("--prompt", help="Prompt text to inject")
    parser.add_argument("--no-submit", action="store_true", help="Only inject without clicking submit")
    parser.add_argument("--download-url", help="Media URL to download via browser extension")
    parser.add_argument("--output-name", help="Custom filename for downloaded asset")
    parser.add_argument("--mode", choices=["image", "video"], default="image", help="Target creation mode: image or video")
    parser.add_argument("--agent", action="store_true", help="Use Google Flow Native Agent mode (natural language intent control)")
    parser.add_argument("--bridge", default=DEFAULT_BRIDGE_URL, help="Bridge daemon endpoint")

    args = parser.parse_args()

    if args.download_url:
        out_name = args.output_name or f"{args.shot_id}_candidate.png"
        print(f">> Downloading media for [{args.shot_id}] as [{out_name}]...")
        res = download_asset(args.download_url, out_name, bridge_url=args.bridge)
        print(json.dumps(res, indent=2, ensure_ascii=False))
        return

    if not args.prompt:
        parser.error("--prompt is required when not downloading")

    mode_label = f"{args.mode} (Agent Mode 智能体)" if args.agent else args.mode
    print(f">> Dispatching storyboard [{args.shot_id}] ({mode_label}) to Flow...")
    res = dispatch_prompt(
        prompt=args.prompt,
        shot_id=args.shot_id,
        mode=args.mode,
        agent=args.agent,
        auto_submit=not args.no_submit,
        bridge_url=args.bridge
    )
    print(json.dumps(res, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
