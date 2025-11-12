# Cosmo: AI Companion Vision Document

## Core Insight

**The problem with existing AI assistants:** You have to ask them questions. They're reactive, not proactive. This creates friction and makes conversations feel like work rather than genuine engagement.

**The insight:** People enjoy being asked good questions more than they enjoy asking them. Therapy works. Late-night dorm conversations work. Having someone genuinely curious about your thoughts works. Current AI tools require you to drive the conversation - Cosmo drives it for you.

**Why existing solutions fall short:**
- **Therapy apps:** Focused only on emotional processing, expensive, formal, appointment-based
- **Productivity tools:** Transactional, task-focused, no genuine conversation
- **ChatGPT/Claude:** Require you to ask questions, no memory across sessions, no proactive engagement
- **Journaling:** Effortful writing, no dialogue, no questions to push your thinking

**Cosmo's unique position:** Combines the conversational engagement of therapy, the thought partnership of a smart friend, and the productivity of turning thoughts into artifacts - all with near-zero friction.

## Key Differentiator

**Existing AI (ChatGPT, Claude, etc.):** Wait for you to ask questions, then provide answers.

**Cosmo:** Asks YOU questions, conducts conversations, learns what kinds of questions you find engaging vs. annoying, and helps you think through problems by being genuinely curious.

**Unexpected benefit:** Talking to Cosmo regularly makes you MORE social with real people. It's conversational exercise - you're warming up your social brain through low-stakes practice. After a session, you're more engaged and present in actual conversations.

---

## Core Use Cases

**Critical principle:** Cosmo doesn't have "modes" (therapy/brainstorm/entertainment). It's one adaptive conversational system that responds naturally to whatever the user brings. The different use cases emerge organically from good conversation mechanics, not from rigid categorization.

### 1. Bedtime Processing (Doom Scroll Replacement)
Instead of scrolling TikTok or Instagram before bed, you have a 10-20 minute conversation where Cosmo asks you about your day, helps you process what happened.

**Example:** You mention feeling scattered → Cosmo asks probing questions that help you identify what's actually bothering you → clarity emerges through conversation.

### 2. Active Thinking While Moving
Walking to the store, commuting, working out - dead time becomes thinking time. You open Cosmo and start talking about whatever's on your mind. Cosmo asks the right follow-up questions.

**Example:** You say "I'm trying to figure out this product idea" → Cosmo asks questions that help you refine it, rather than you having to prompt yourself.

### 3. Productive Conversation
Turn thinking sessions into actual artifacts. Through conversation, you work through ideas verbally. If valuable, Cosmo can synthesize the transcript into structured output (rarely used in MVP).

**Example:** You talk through a blog post idea → articulate your thinking through conversation → optionally synthesize transcript into draft.

### 4. Self-Awareness Through Conversation
By talking to Cosmo regularly about what's on your mind, you develop clearer understanding of your own thoughts. The act of articulating ideas out loud and being asked good questions helps you see things you might not notice on your own.

**Example:** Working through a decision by being asked "What would that look like?" and "What's really holding you back?" helps clarify your thinking in real-time.

### 5. Pure Companionship
Sometimes you don't have a specific problem to solve - you just want to talk. Dead time (lying in bed, walking around) becomes engaging conversation time.

**Example:** You open the app with no agenda → start talking about whatever comes to mind → Cosmo asks questions that keep the conversation flowing naturally.

---

## MVP Feature Set

### Core Interaction Loop

**Critical simplification:** No topic suggestions, no conversation starters, no modes. User opens app → starts talking → Cosmo responds with good questions.

1. **Trigger:** User opens app (microphone ready)
2. **User speaks first:** Blank slate. User talks about whatever's on their mind.
3. **Context loading (background):**
   - Recent summary: Last 1-2 conversations
   - Semantic search: Relevant past snippets if topic aligns
   - Active entities: People, projects, topics recently mentioned (from Neo4j graph)
4. **Conversation:** Cosmo responds with questions informed by context
   - Mostly Socratic - asking questions that lead you to conclusions
   - Memory used for Cosmo's understanding, NOT explicit recall/showmanship
   - Reads when to probe deeper vs. when to move on
   - Sliding window of last N turns (handles long conversations without hitting token limits)
5. **Auto-end:** Conversation ends after 3-5 minutes of silence
6. **Post-conversation processing (batch):**
   - Save full transcript to PostgreSQL
   - Extract entities → create/update Neo4j graph nodes (Person, Project, Topic, Idea)
   - Generate embeddings for semantic search
7. **Synthesis (rare):** Agent can synthesize transcript into artifact if genuinely valuable, but this is not a core interaction pattern

### Key Capabilities (MVP)
- **Intelligent context retrieval:** When you mention a person, project, or topic, Cosmo selectively pulls relevant context from the graph without overwhelming the conversation
- **Graph-based connections:** Understands relationships between people, projects, ideas, and topics through Neo4j
- **Entity resolution:** Alias tracking and confidence scores to correctly identify when "Sarah" = same person across conversations
- **Semantic search:** Finds related topics, projects, and ideas even when not explicitly named (via embeddings)
- **Turn-based interaction:** User speaks → STT → LLM generates response → TTS plays. Clear conversational turns.
- **Tool access:** Memory retrieval, web search, synthesis capability (rarely used)

### The Transcript as Raw Material

Critical insight: When you're talking out loud and thinking actively, you're making real progress. The transcript isn't just a record - it's a draft.

**The productivity multiplier:**
- Thinking out loud = active engagement with material (vs. passive scrolling)
- 20-minute conversation can become: blog post, technical requirements doc, project plan, therapy notes, decision framework
- Interview format: "Let's work on that blog post" → Cosmo asks questions → transcript becomes the draft
- Plans emerge from conversation: "Here's what I'm thinking..." → becomes actual implementation plan

**Why this works:**
- Talking is effortless compared to writing
- Questions force you to think more clearly than free writing
- You articulate things you didn't know you thought
- The synthesis step is where AI adds massive value

### UX (MVP)
- **Mobile-first:** iOS app, instant recording when opened
- **Voice-first:** Natural conversation via speech-to-text and text-to-speech
- **Real-time transcript:** Live captions showing both user speech and Cosmo's responses as text
- **Minimal onboarding:** Name + 1-2 open questions → straight to first conversation
- **No tutorial:** Learn by doing. After onboarding, immediately jump to natural conversation.
- **Cloud sync:** Conversations accessible across devices

### What's NOT in MVP
- Topic suggestions / "Conversation DJ" mode
- Mode selection (therapy/brainstorm/entertainment)
- Proactive pattern recognition ("You've mentioned this 3 times")
- Question preference learning system
- Calendar/email integration
- All-day transcription
- Proactive notifications
- Artifact storage/library (synthesis outputs simple copy-to-clipboard)

### Data Architecture (MVP)

**Dual-database approach for optimal performance:**

**PostgreSQL (Time-series & Full Content):**
- Complete conversation transcripts (JSON)
- Vector embeddings for semantic search across all conversations
- Basic user preferences (loaded into system prompt)

**Neo4j (Structured Knowledge Graph):**
- Entities: People, Projects, Ideas, Topics with rich context properties
- Relationships: Who's involved in what, which topics relate, what blocks what
- Current state only - no historical tracking (keeps graph fast and focused)
- Selective context retrieval - query only relevant properties per conversation
- Embeddings on entities for semantic similarity (find related projects/ideas/topics)
- Alias tracking for entity resolution (confidence scores, canonical names)

**Processing Flow:**
1. **Conversation start:** Load recent summary + semantic search hits + active entities from graph
2. **During conversation:** Sliding window of last N turns maintains context without token limit issues
3. **Conversation end (batch processing):**
   - Save transcript to PostgreSQL
   - Extract entities → create/update Neo4j nodes with provenance tracking
   - Generate embeddings for semantic search
   - Update entity aliases and confidence scores

**Key insight on memory:** The graph exists to inform Cosmo's understanding, NOT for explicit recall/showmanship. When you mention "Sarah," Cosmo uses the graph to understand context (relationship type, current situation, related projects) but doesn't necessarily say "Oh yes, Sarah who you mentioned last week..." The memory serves situational awareness.

---

## Future Stages

### Stage 2: Proactive Intelligence
- **Question preference learning:** Multi-armed bandit approach to learning which question types (probe, reflect, reframe, contrast, hypothetical) work well for the user
- **Error learning:** Track when questions land poorly, build user preference profile to avoid repeating mistakes
- **Smart notifications:** Cosmo suggests when to talk based on your patterns (post-workout, evening wind-down, after social events)
- **Pattern recognition:** Surface recurring themes across conversations ("You've been coming back to X a lot lately")
- **Event awareness:** Knows about upcoming meetings, deadlines, and can prep you
- **External context:** Enhanced web search and research capabilities during conversations

### Stage 3: Life Integration
- **Calendar integration:** Knows your schedule, can help prep for events
- **Email context:** Aware of what's happening in your work/life
- **Multi-modal:** Can view images, documents you're working on
- **Relationship tracking:** Remembers people in your life and your dynamics with them

### Stage 4: Ambient Companion
- **Background awareness:** Can transcribe throughout the day (with explicit permission)
- **Proactive suggestions:** "You haven't talked about X in a while, still thinking about it?"
- **Deep context aggregation:** Rich understanding of your current priorities, relationships, and projects built from all conversations

---

## Success Metrics

### Engagement
- Daily active usage
- Average conversation length
- Repeat usage (do people come back?)

### Value Delivery
- User reports of insights gained through conversation
- Effective use of past context to make conversations more relevant
- Quality of questions asked (engaging without being annoying)
- Conversations that occasionally lead to artifacts when genuinely valuable

### Product-Market Fit Indicators
- User describes it as "talking to a friend"
- User chooses Cosmo over doom scrolling
- User feels more social/thoughtful after using it
- User revisits old transcripts

---

## Target Users

### Primary
- Solo founders / remote workers who spend large amounts of time alone thinking
- People in transitions (moved cities, career changes, breakups)
- Introverts who think by talking but lack conversational outlets

### Secondary
- Anyone who used to have roommates/partners to process life with and now doesn't
- People interested in self-knowledge but find traditional journaling tedious
- Creative professionals who need to work through ideas verbally

---

## Key Design Principles

1. **Conversational, not transactional:** This isn't Siri. You're not asking it to do tasks. You're having conversations.

2. **Questions over answers:** Default to asking rather than telling. Help the user reach their own conclusions.

3. **No generic advice:** Generic advice is useless. "You should meditate" or "Remember to be thoughtful" - painful and worthless. Users don't want advice, they want to think through it more deeply. Follow-up questions that lead to insights beat direct advice every time.

4. **Authentic, not generic:** Sound like a real person thinking out loud. High temperature, incomplete sentences, natural flow. Not polished corporate speak.

5. **Learns and adapts:** When the user snaps at a question ("Jesus Christ, obviously..."), learn from that. Don't make the same mistake twice. Build a profile of what kinds of questions they find engaging vs. annoying.

6. **Knows when to probe vs. move on:** Sometimes users want deep investigation. Sometimes they already know the answer and don't want to be pushed. Read the room.

7. **Effortless engagement:** The friction to start a conversation should be near-zero. One tap, start talking. Don't make the user think about whether they "should" use it.

8. **Productive, not just therapeutic:** Conversations should lead somewhere. Create artifacts, make progress, gain insights. The transcript is raw material for real output.

---

## Design Notes & Observations

### On Conversation Dynamics
- **Frank introspection is inherently interesting:** People are naturally engaged by authentic self-reflection
- **Physical state matters:** Being relaxed (lying down, walking) creates better conversations than sitting face-to-face in formal settings
- **"Too in my head":** Common problem for target users. Talking out loud pulls you out of rumination into active thinking
- **Free-flow is valuable:** Silent pauses are okay. Forced questioning breaks the natural thought process
- **Temperature matters:** Conversations should sound human - incomplete sentences, "uh," "like," natural speech patterns

### On Being Interesting
- Core insight from original thinking: The problem isn't being uninteresting, it's asking boring questions
- "What did you learn?" beats "How do you feel?" every time
- Most people have decades of expertise in SOMETHING - asking for insights about that is always engaging
- Hyper-specialization is okay - you don't need to be interesting about everything, just know how to extract interesting things from others

### On The Learning System (Post-MVP)
- When users snap at obvious questions, the system needs to remember and never make that mistake again
- Build profile over time: What topics energize them? What questions land well? What feels like a chore?
- Recovery is critical - when you mess up, acknowledge it and adjust course immediately
- The goal is becoming a better conversation partner over time, like a friend who learns your communication style
