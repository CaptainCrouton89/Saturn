#!/usr/bin/env python3
"""
Download remaining open AI conversation datasets with proper serialization
"""

import json
from datetime import datetime
from datasets import load_dataset
from pathlib import Path

output_dir = Path("./datasets")
output_dir.mkdir(exist_ok=True)

def serialize_item(obj):
    """Convert non-serializable objects to strings"""
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, dict):
        return {k: serialize_item(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [serialize_item(item) for item in obj]
    else:
        return obj

print("=" * 80)
print("Downloading More AI Conversation Datasets")
print("=" * 80)

# 1. WildChat with proper datetime handling
print("\n[1/3] Downloading WildChat (fixed)...")
try:
    wildchat_dataset = load_dataset("allenai/WildChat-1M", split="train", streaming=True)

    wildchat_sample = []
    for i, item in enumerate(wildchat_dataset):
        if i >= 10000:
            break
        wildchat_sample.append(serialize_item(dict(item)))

    wildchat_path = output_dir / "wildchat_10k_sample.json"
    with open(wildchat_path, 'w', encoding='utf-8') as f:
        json.dump(wildchat_sample, f, indent=2, ensure_ascii=False)

    print(f"✓ WildChat downloaded!")
    print(f"  Sample size: {len(wildchat_sample):,} conversations")
    print(f"  Saved to: {wildchat_path}")

    if wildchat_sample:
        print(f"  Example fields: {list(wildchat_sample[0].keys())}")

except Exception as e:
    print(f"✗ Error: {e}")

# 2. OpenAssistant Conversations
print("\n[2/3] Downloading OpenAssistant Conversations...")
try:
    oasst_dataset = load_dataset("OpenAssistant/oasst1", split="train")

    oasst_path = output_dir / "openassistant_conversations.json"
    with open(oasst_path, 'w', encoding='utf-8') as f:
        json.dump([serialize_item(dict(item)) for item in oasst_dataset], f, indent=2, ensure_ascii=False)

    print(f"✓ OpenAssistant downloaded!")
    print(f"  Total conversations: {len(oasst_dataset):,}")
    print(f"  Saved to: {oasst_path}")

except Exception as e:
    print(f"✗ Error: {e}")

# 3. Anthropic HH-RLHF (Helpful and Harmless)
print("\n[3/3] Downloading Anthropic HH-RLHF...")
try:
    hhrlhf_dataset = load_dataset("Anthropic/hh-rlhf", split="train")

    # Save sample
    hhrlhf_sample = hhrlhf_dataset.select(range(min(10000, len(hhrlhf_dataset))))
    hhrlhf_path = output_dir / "anthropic_hh_rlhf_10k_sample.json"

    with open(hhrlhf_path, 'w', encoding='utf-8') as f:
        json.dump([serialize_item(dict(item)) for item in hhrlhf_sample], f, indent=2, ensure_ascii=False)

    print(f"✓ Anthropic HH-RLHF downloaded!")
    print(f"  Total conversations: {len(hhrlhf_dataset):,}")
    print(f"  Sample saved to: {hhrlhf_path}")

except Exception as e:
    print(f"✗ Error: {e}")

print("\n" + "=" * 80)
print("Final Summary - All Downloaded Datasets")
print("=" * 80)
print(f"Location: {output_dir.absolute()}")
print("\nFiles:")
total_size_mb = 0
for file in sorted(output_dir.glob("*.json")):
    size_mb = file.stat().st_size / (1024 * 1024)
    total_size_mb += size_mb
    print(f"  - {file.name:<50} {size_mb:>8.2f} MB")

print(f"\nTotal size: {total_size_mb:.2f} MB")
print("\n✓ All downloads complete!")
