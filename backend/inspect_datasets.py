#!/usr/bin/env python3
"""
Quick inspection of downloaded conversation datasets
"""

import json
from pathlib import Path
from collections import Counter

datasets_dir = Path("./datasets")

def inspect_dataset(file_path):
    """Inspect a single dataset and print summary stats"""
    print(f"\n{'='*80}")
    print(f"📊 {file_path.name}")
    print(f"{'='*80}")

    with open(file_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    print(f"Total items: {len(data):,}")

    if not data:
        print("Empty dataset!")
        return

    # Show first item structure
    first_item = data[0]
    print(f"\nFields: {list(first_item.keys())}")

    # Try to count conversation lengths
    if 'conversation' in first_item:
        lengths = [len(item.get('conversation', [])) for item in data]
        print(f"\nConversation turn statistics:")
        print(f"  Min turns: {min(lengths)}")
        print(f"  Max turns: {max(lengths)}")
        print(f"  Avg turns: {sum(lengths)/len(lengths):.1f}")

    # Show languages if available
    if 'language' in first_item:
        languages = [item.get('language') for item in data if item.get('language')]
        lang_counts = Counter(languages)
        print(f"\nTop 5 languages:")
        for lang, count in lang_counts.most_common(5):
            print(f"  {lang}: {count:,} ({100*count/len(data):.1f}%)")

    # Show example conversation
    print(f"\n📝 Example conversation:")
    if 'conversation' in first_item:
        conv = first_item['conversation'][:3]  # First 3 turns
        for turn in conv:
            role = turn.get('role', turn.get('speaker_role', 'unknown'))
            content = turn.get('content', turn.get('utterance', ''))[:100]
            print(f"  [{role}]: {content}...")
    elif 'messages' in first_item:
        msgs = first_item['messages'][:2]
        for msg in msgs:
            role = msg.get('role', 'unknown')
            content = msg.get('content', '')[:100]
            print(f"  [{role}]: {content}...")
    elif 'chosen' in first_item:
        print(f"  [chosen]: {first_item['chosen'][:150]}...")
    else:
        print(f"  Structure: {json.dumps(first_item, indent=2)[:300]}...")

# Inspect all datasets
json_files = sorted(datasets_dir.glob("*.json"))

print("="*80)
print("🔍 AI CONVERSATION DATASETS INSPECTION")
print("="*80)
print(f"\nFound {len(json_files)} datasets")

for json_file in json_files:
    try:
        inspect_dataset(json_file)
    except Exception as e:
        print(f"\n❌ Error inspecting {json_file.name}: {e}")

print("\n" + "="*80)
print("✅ Inspection complete!")
print("="*80)
