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


def dispatch_prompt(prompt: str, shot_id: str = "V01", auto_submit: bool = True, bridge_url: str = DEFAULT_BRIDGE_URL) -> Dict[str, Any]:
    """Dispatch prompt directly into Google Flow active tab via Flow Agent Daemon."""
    warnings = check_compliance(prompt)
    payload = json.dumps({
        "prompt": prompt,
        "auto_submit": auto_submit,
        "shot_id": shot_id
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

    print(f">> Dispatching prompt for [{args.shot_id}] via Flow Agent Bridge...")
    res = dispatch_prompt(
        prompt=args.prompt,
        shot_id=args.shot_id,
        auto_submit=not args.no_submit,
        bridge_url=args.bridge
    )
    print("\nDispatch Result:")
    print(json.dumps(res, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
