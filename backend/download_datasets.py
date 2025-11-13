#!/usr/bin/env python3
"""
Download high-quality AI conversation datasets:
1. LMSYS-Chat-1M - 1M real conversations with 25 LLMs
2. LoCoMo - Long-term conversation memory dataset
"""

import os
import json
from datasets import load_dataset
from pathlib import Path

# Create output directory
output_dir = Path("./datasets")
output_dir.mkdir(exist_ok=True)

print("=" * 80)
print("Downloading AI Conversation Datasets")
print("=" * 80)

# 1. Download LMSYS-Chat-1M dataset
print("\n[1/2] Downloading LMSYS-Chat-1M dataset...")
print("This contains 1M real conversations from 210K users with 25 different LLMs")
print("Downloading... (this may take several minutes)")

try:
    lmsys_dataset = load_dataset("lmsys/lmsys-chat-1m", split="train")

    # Save sample to JSON for inspection
    lmsys_sample = lmsys_dataset.select(range(min(1000, len(lmsys_dataset))))
    lmsys_sample_path = output_dir / "lmsys_chat_1m_sample.json"

    with open(lmsys_sample_path, 'w', encoding='utf-8') as f:
        json.dump([dict(item) for item in lmsys_sample], f, indent=2, ensure_ascii=False)

    print(f"✓ LMSYS-Chat-1M downloaded successfully!")
    print(f"  Total conversations: {len(lmsys_dataset):,}")
    print(f"  Sample saved to: {lmsys_sample_path}")
    print(f"  Full dataset object available as: lmsys_dataset")

    # Show example conversation
    if len(lmsys_dataset) > 0:
        example = lmsys_dataset[0]
        print(f"\n  Example conversation:")
        print(f"    Language: {example.get('language', 'N/A')}")
        print(f"    Model: {example.get('model', 'N/A')}")
        print(f"    Turns: {len(example.get('conversation', []))}")

except Exception as e:
    print(f"✗ Error downloading LMSYS-Chat-1M: {e}")

# 2. Download LoCoMo dataset
print("\n[2/2] Downloading LoCoMo (Long Conversation Memory) dataset...")
print("This contains very long multi-session conversations (300+ turns, 9K+ tokens avg)")
print("Downloading...")

try:
    # Try the original dataset
    locomo_dataset = load_dataset("Aman279/Locomo", split="train")

    # Save to JSON
    locomo_path = output_dir / "locomo_dataset.json"

    with open(locomo_path, 'w', encoding='utf-8') as f:
        json.dump([dict(item) for item in locomo_dataset], f, indent=2, ensure_ascii=False)

    print(f"✓ LoCoMo downloaded successfully!")
    print(f"  Total conversations: {len(locomo_dataset):,}")
    print(f"  Saved to: {locomo_path}")

    # Show example
    if len(locomo_dataset) > 0:
        example = locomo_dataset[0]
        print(f"\n  Example conversation:")
        for key, value in example.items():
            if isinstance(value, (list, dict)):
                print(f"    {key}: {type(value).__name__} with {len(value)} items")
            else:
                preview = str(value)[:100]
                print(f"    {key}: {preview}{'...' if len(str(value)) > 100 else ''}")

except Exception as e:
    print(f"✗ Error downloading LoCoMo: {e}")

print("\n" + "=" * 80)
print("Download Summary")
print("=" * 80)
print(f"Datasets saved to: {output_dir.absolute()}")
print("\nFiles created:")
for file in sorted(output_dir.glob("*.json")):
    size_mb = file.stat().st_size / (1024 * 1024)
    print(f"  - {file.name} ({size_mb:.2f} MB)")

print("\n✓ Download complete!")
