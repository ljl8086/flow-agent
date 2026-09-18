/**
 * Flow Agent Bridge - Content Script
 * Handles DOM prompt injection, physical pointer simulation, and UI event coordination.
 * Copyright (c) 2026 ljl8086. Licensed under MIT.
 */
(() => {
  if (globalThis.__FLOW_AGENT_LOADED__) return;
  globalThis.__FLOW_AGENT_LOADED__ = true;

  // In-page feedback toast
  function showAgentToast(message, isSuccess = true) {
    let toast = document.getElementById('__flow_agent_toast__');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = '__flow_agent_toast__';
      toast.style.cssText = `
        position: fixed;
        top: 24px;
        right: 24px;
        z-index: 9999999;
        padding: 14px 20px;
        background: #18181b;
        color: #fafafa;
        border: 1px solid ${isSuccess ? '#22c55e' : '#ef4444'};
        border-radius: 10px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.5);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 10px;
        transition: opacity 0.3s ease, transform 0.3s ease;
        transform: translateY(-10px);
        opacity: 0;
      `;
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span style="font-size: 18px;">${isSuccess ? '⚡' : '⚠️'}</span> <span>${message}</span>`;
    requestAnimationFrame(() => {
      toast.style.transform = 'translateY(0)';
      toast.style.opacity = '1';
    });
    clearTimeout(toast.__timer);
    toast.__timer = setTimeout(() => {
      toast.style.transform = 'translateY(-10px)';
      toast.style.opacity = '0';
    }, 4500);
  }

  // Precise DOM search for prompt input (filtering out top search bar)
  function findPromptInput() {
    const all = Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"]')).filter(
      el => el.offsetWidth > 0 && el.offsetHeight > 0
    );

    const nonSearch = all.filter(el => {
      const ph = (el.placeholder || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const rect = el.getBoundingClientRect();
      if (type === 'search' || ph.includes('search') || ph.includes('搜索') || aria.includes('search') || aria.includes('搜索')) {
        return false;
      }
      if (rect.top < window.innerHeight * 0.15 && rect.left > window.innerWidth * 0.2 && rect.right < window.innerWidth * 0.8) {
        return false;
      }
      return true;
    });

    const promptMatch = nonSearch.find(el => {
      const ph = (el.placeholder || '').toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').toLowerCase();
      return ph.includes('创作') || ph.includes('提示') || ph.includes('prompt') || 
             ph.includes('describe') || ph.includes('create') ||
             aria.includes('创作') || aria.includes('prompt') || aria.includes('describe');
    });
    if (promptMatch) return promptMatch;

    const textarea = nonSearch.find(el => el.tagName === 'TEXTAREA');
    if (textarea) return textarea;

    const bottomCandidates = nonSearch.filter(el => {
      const rect = el.getBoundingClientRect();
      return rect.top > window.innerHeight * 0.4 && rect.width > 120;
    });
    if (bottomCandidates.length > 0) {
      return bottomCandidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top)[0];
    }
    return null;
  }

  // Physical pointer simulation (resolves Angular/WebComponent synthetic event ignores)
  function robustClick(el) {
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clientX = rect.left + rect.width / 2;
    const clientY = rect.top + rect.height / 2;
    const opts = { bubbles: true, cancelable: true, view: window, clientX, clientY };
    
    el.focus?.();
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  function triggerEnter(inputEl) {
    if (!inputEl) return;
    inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
    inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
  }

  function findSubmitButton(inputEl) {
    if (!inputEl) return null;

    let card = inputEl;
    for (let i = 0; i < 8 && card; i++) {
      card = card.parentElement;
      if (!card) break;
      const btns = Array.from(card.querySelectorAll('button, [role="button"]')).filter(
        b => b.offsetWidth > 0 && b.offsetHeight > 0
      );
      if (btns.length >= 2) {
        const labeled = btns.find(b => {
          const aria = (b.getAttribute('aria-label') || '').toLowerCase();
          const title = (b.getAttribute('title') || '').toLowerCase();
          const txt = (b.textContent || '').trim().toLowerCase();
          return aria.includes('generate') || aria.includes('submit') || aria.includes('send') || 
                 aria.includes('生成') || aria.includes('发送') || aria.includes('创建') ||
                 title.includes('generate') || title.includes('submit') || title.includes('send') ||
                 title.includes('生成') || title.includes('发送') ||
                 txt === 'generate' || txt === '生成';
        });
        if (labeled) return labeled;

        const arrowBtn = btns.find(b => {
          const txt = (b.textContent || '').trim();
          if (txt === '+' || txt.includes('智能体') || txt.includes('视频') || txt.includes('图片') || txt === '×') return false;
          return !!b.querySelector('svg') || b.textContent.includes('arrow_forward');
        });
        if (arrowBtn) return arrowBtn;

        const sorted = [...btns].sort((a, b) => {
          const ra = a.getBoundingClientRect();
          const rb = b.getBoundingClientRect();
          return (rb.right + rb.bottom) - (ra.right + ra.bottom);
        });
        if (sorted.length > 0) return sorted[0];
      }
    }

    const allBtns = Array.from(document.querySelectorAll('button, [role="button"]')).filter(
      b => b.offsetWidth > 0 && b.offsetHeight > 0
    );
    return allBtns.find(b => {
      const txt = (b.textContent || '').trim().toLowerCase();
      const aria = (b.getAttribute('aria-label') || '').toLowerCase();
      return (txt === 'generate' || txt === '生成' || aria.includes('generate') || aria.includes('生成'));
    }) || null;
  }

  function setNativeValue(element, value) {
    if (element.tagName === 'TEXTAREA' || element.tagName === 'INPUT') {
      const prototype = element.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (descriptor && descriptor.set) {
        descriptor.set.call(element, value);
      } else {
        element.value = value;
      }
    } else if (element.isContentEditable) {
      element.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, value);
      return;
    } else {
      element.textContent = value;
    }
    element.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
  }

  function switchModeIfNeeded(targetMode) {
    if (!targetMode) return;
    const modeStr = targetMode.toLowerCase(); // 'image' or 'video'
    const isImageTarget = modeStr.includes('image') || modeStr.includes('img') || modeStr.includes('图');
    const isVideoTarget = modeStr.includes('video') || modeStr.includes('vid') || modeStr.includes('视频');

    const pills = Array.from(document.querySelectorAll('button, [role="button"]')).filter(b => {
      const txt = (b.textContent || '').trim();
      const rect = b.getBoundingClientRect();
      return (txt.includes('视频') || txt.includes('Nano Banana') || txt.includes('图片') || txt.includes('Imagen')) &&
             rect.top > window.innerHeight * 0.5 && b.offsetWidth > 0;
    });

    if (pills.length === 0) return;
    const currentPill = pills[0];
    const currentTxt = currentPill.textContent || '';
    const isCurrentlyVideo = currentTxt.includes('视频');
    const isCurrentlyImage = currentTxt.includes('Nano Banana') || currentTxt.includes('图片') || currentTxt.includes('Imagen');

    if ((isImageTarget && isCurrentlyImage) || (isVideoTarget && isCurrentlyVideo)) {
      return; // Already in correct mode
    }

    // Click pill to open model/mode selection menu
    robustClick(currentPill);

    // Wait and select the target item from dropdown/menu
    setTimeout(() => {
      const menuItems = Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, div[class*="item"]')).filter(
        el => el.offsetWidth > 0 && el.offsetHeight > 0
      );
      const targetItem = menuItems.find(el => {
        const txt = (el.textContent || '').trim();
        return isImageTarget ? (txt.includes('图片') || txt.includes('Nano Banana') || txt.includes('Image')) : (txt.includes('视频') || txt.includes('Video'));
      });
      if (targetItem) {
        robustClick(targetItem);
      }
    }, 200);
  }

  chrome.runtime.onMessage.addListener((msg, _, reply) => {
    if (msg.type === 'INJECT_PROMPT') {
      const prompt = msg.prompt || '';
      const autoSubmit = !!msg.auto_submit;
      const shotId = msg.shot_id || '当前分镜';
      const targetMode = msg.mode || '';

      // Auto switch to Image or Video mode if requested
      if (targetMode) {
        switchModeIfNeeded(targetMode);
      }

      const input = findPromptInput();
      if (!input) {
        showAgentToast(`未找到提示词输入框，请确认已进入画布！`, false);
        reply({ status: 404, error: 'PROMPT_INPUT_NOT_FOUND' });
        return true;
      }

      input.focus();
      setNativeValue(input, prompt);

      if (autoSubmit) {
        showAgentToast(`[Flow Agent]: 已填入 ${shotId} 提示词，正在点击生成...`, true);
        setTimeout(() => {
          const btn = findSubmitButton(input);
          let btnInfo = null;
          if (btn) {
            btnInfo = {
              tag: btn.tagName,
              aria: btn.getAttribute('aria-label'),
              title: btn.getAttribute('title'),
              text: btn.textContent?.trim().slice(0, 30),
            };
            robustClick(btn);
          } else {
            // Only trigger Enter as fallback if button not found (prevents double empty submit)
            triggerEnter(input);
          }

          showAgentToast(`[Flow Agent]: ${shotId} 任务已触发提交！`, true);
          reply({
            status: 200,
            message: 'SUBMITTED',
            button_found: !!btn,
            button_info: btnInfo,
            prompt_length: prompt.length
          });
        }, 500);
      } else {
        showAgentToast(`[Flow Agent]: 已成功填入 ${shotId} 提示词！`, true);
        reply({ status: 200, message: 'INJECTED_ONLY', prompt_length: prompt.length });
      }
      return true;
    }

    if (msg.type === 'SCAN_CANVAS_MEDIA') {
      const mediaItems = [];
      const imgs = Array.from(document.querySelectorAll('img')).filter(
        el => el.offsetWidth > 100 && el.offsetHeight > 100 && el.src && !el.src.includes('avatar')
      );
      for (const img of imgs) {
        mediaItems.push({ type: 'image', url: img.src, alt: img.alt || '' });
      }
      const vids = Array.from(document.querySelectorAll('video')).filter(
        el => el.offsetWidth > 100 && el.offsetHeight > 100 && el.src
      );
      for (const v of vids) {
        mediaItems.push({ type: 'video', url: v.src });
      }
      reply({ status: 200, media: mediaItems });
      return true;
    }
  });
})();
