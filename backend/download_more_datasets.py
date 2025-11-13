#!/usr/bin/env python3
"""
Download additional open AI conversation datasets
"""

import json
from datasets import load_dataset
from pathlib import Path

output_dir = Path("./datasets")
output_dir.mkdir(exist_ok=True)

print("=" * 80)
print("Downloading Additional AI Conversation Datasets")
print("=" * 80)

# 1. Chatbot Arena Conversations
print("\n[1/4] Downloading LMSYS Chatbot Arena Conversations...")
print("Real conversations with human preferences from Chatbot Arena")

try:
    arena_dataset = load_dataset("lmsys/chatbot_arena_conversations", split="train")

    arena_path = output_dir / "chatbot_arena_conversations.json"
    with open(arena_path, 'w', encoding='utf-8') as f:
        json.dump([dict(item) for item in arena_dataset], f, indent=2, ensure_ascii=False)

    print(f"✓ Chatbot Arena Conversations downloaded!")
    print(f"  Total conversations: {len(arena_dataset):,}")
    print(f"  Saved to: {arena_path}")

    if len(arena_dataset) > 0:
        example = arena_dataset[0]
        print(f"\n  Example fields: {list(example.keys())}")

except Exception as e:
    print(f"✗ Error: {e}")

# 2. WildChat - Diverse conversations
print("\n[2/4] Downloading WildChat...")
print("In-the-wild conversations covering diverse topics")

try:
    wildchat_dataset = load_dataset("allenai/WildChat-1M", split="train", streaming=True)

    # Take first 10k conversations to avoid massive download
    wildchat_sample = []
    for i, item in enumerate(wildchat_dataset):
        if i >= 10000:
            break
        wildchat_sample.append(dict(item))

    wildchat_path = output_dir / "wildchat_10k_sample.json"
    with open(wildchat_path, 'w', encoding='utf-8') as f:
        json.dump(wildchat_sample, f, indent=2, ensure_ascii=False)

    print(f"✓ WildChat downloaded!")
    print(f"  Sample size: {len(wildchat_sample):,} conversations (from 1M total)")
    print(f"  Saved to: {wildchat_path}")

except Exception as e:
    print(f"✗ Error: {e}")

# 3. ShareGPT - User-shared ChatGPT conversations
print("\n[3/4] Downloading ShareGPT conversations...")
print("Real ChatGPT conversations shared by users")

try:
    sharegpt_dataset = load_dataset("anon8231489123/ShareGPT_Vicuna_unfiltered", split="train")

    # Save a sample
    sharegpt_sample = sharegpt_dataset.select(range(min(10000, len(sharegpt_dataset))))
    sharegpt_path = output_dir / "sharegpt_sample.json"

    with open(sharegpt_path, 'w', encoding='utf-8') as f:
        json.dump([dict(item) for item in sharegpt_sample], f, indent=2, ensure_ascii=False)

    print(f"✓ ShareGPT downloaded!")
    print(f"  Total conversations: {len(sharegpt_dataset):,}")
    print(f"  Sample saved to: {sharegpt_path}")

except Exception as e:
    print(f"✗ Error: {e}")

# 4. UltraChat - Synthetic but high-quality
print("\n[4/4] Downloading UltraChat...")
print("High-quality synthetic conversations covering diverse domains")

try:
    ultrachat_dataset = load_dataset("HuggingFaceH4/ultrachat_200k", split="train_sft")

    # Save sample
    ultrachat_sample = ultrachat_dataset.select(range(min(10000, len(ultrachat_dataset))))
    ultrachat_path = output_dir / "ultrachat_10k_sample.json"

    with open(ultrachat_path, 'w', encoding='utf-8') as f:
        json.dump([dict(item) for item in ultrachat_sample], f, indent=2, ensure_ascii=False)

    print(f"✓ UltraChat downloaded!")
    print(f"  Total conversations: {len(ultrachat_dataset):,}")
    print(f"  Sample saved to: {ultrachat_path}")

except Exception as e:
    print(f"✗ Error: {e}")

print("\n" + "=" * 80)
print("Download Summary")
print("=" * 80)
print(f"All datasets saved to: {output_dir.absolute()}")
print("\nAll files:")
for file in sorted(output_dir.glob("*.json")):
    size_mb = file.stat().st_size / (1024 * 1024)
    print(f"  - {file.name} ({size_mb:.2f} MB)")

print("\n✓ Download complete!")
