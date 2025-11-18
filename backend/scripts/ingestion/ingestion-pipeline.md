# Ingestion Pipeline

> **Related Documentation**:
> - [architecture.md](./architecture.md) - Memory architecture
> - [agent-tools.md](./agent-tools.md) - Agent tools API
> - [decay.md](./decay.md) - Decay mechanics
> - [hierarchical-memory.md](./hierarchical-memory.md) - Storyline/Macro promotion

## Overview

The ingestion pipeline transforms raw episodic data into personal semantic knowledge stored in Neo4j. **Semantic extraction is user-scoped** with authorship tracking. Sources can be team-scoped or personal.

### Overall Architecture

**Single-Database Model (Neo4j)**:
- **Source nodes**: Store both raw and processed data, metadata, and processing status
- **Semantic graph**: Extracted entities (Person, Concept, Entity) with relationships
- **Processing pipeline**: Updates Source node in-place through 3 phases

**Status Flow**: `raw` → `processed` → `extracted`
