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

### 1. Bedtime Processing (Doom Scroll Replacement)
Instead of scrolling TikTok or Instagram before bed, you have a 10-20 minute conversation where Cosmo asks you about your day, helps you process what happened, surfaces patterns you might not notice.

**Example:** "Hey, I noticed you've mentioned feeling scattered about dating three times this week. Want to talk about what's actually going on there?"

### 2. Active Thinking While Moving
Walking to the store, commuting, working out - dead time becomes thinking time. You trigger Cosmo and it helps you work through whatever's on your mind by asking the right follow-up questions.

**Example:** You say "I'm trying to figure out this product idea" → Cosmo asks probing questions that help you refine it, rather than you having to prompt yourself.

### 3. Productive Conversation
Turn thinking sessions into actual artifacts. Cosmo can interview you about a blog post, startup idea, or technical problem - then synthesize the transcript into structured output.

**Example:** "Let's work on that blog post you mentioned. What's the core idea?" → 20 minute conversation → "Want me to draft this into an article?"

### 4. Pattern Recognition & Self-Awareness
By talking to Cosmo regularly, patterns emerge that you wouldn't notice. It can spot when your current beliefs conflict with each other, when your behavior doesn't match your stated values, or when you're circling around something without addressing it directly.

**Example:** "You keep saying you want someone independent, but every person you're excited about is super available. What's that about?"

**Note:** This is about current state analysis - spotting contradictions in what you believe/want *right now*, not tracking how beliefs have changed over time.

### 5. Pure Entertainment/Companionship
Sometimes you don't have a specific problem to solve - you just want to talk to someone interesting. Dead time (lying in bed, walking around) becomes engaging conversation time.

**Example:** User doesn't know what they want to talk about. Cosmo: "Hey - been thinking about your relationship stuff, that startup idea, and I saw this AI news. What sounds interesting?" User just wants to be entertained by conversation, and Cosmo does the work of making it engaging.

---

## MVP Feature Set

### Core Interaction Loop ("Conversation DJ")

The key insight: users often want to talk but don't know WHAT to talk about. Cosmo does the work of figuring out the topic and conducting the conversation.

1. **Trigger:** User taps notification or says "Hey Cosmo, let's chat"
2. **Opening:** Cosmo analyzes what's "active" in your life (recent topics, unresolved threads, recurring themes) and suggests conversation starters
   - "I know you've been thinking about the blog, that relationship thing, and your startup idea. What do you want to dig into?"
   - User picks one, or says "surprise me" and Cosmo picks
   - Or user just starts talking about something else entirely
3. **Conversation:** Cosmo asks questions, occasionally adds ideas, follows the thread wherever it goes naturally
   - Mostly Socratic - asking questions that lead you to conclusions
   - Sometimes builds on your ideas or connects to other things you've talked about
   - Reads when to probe deeper vs. when to move on
4. **Synthesis:** Option to turn transcript into structured output (blog draft, plan, notes)
   - "Want me to turn this into a blog draft?"
   - "Should I make this into a project plan?"
5. **Archive:** All conversations saved, searchable, and used to inform future conversations

### Key Capabilities (MVP)
- **Intelligent context retrieval:** When you mention a person, project, or topic, Cosmo selectively pulls relevant context (relationship dynamics, current status, recent updates) without overwhelming the conversation
- **Conversation topic discovery:** Analyzes what's "active" in your life and suggests engaging conversation starters based on recency, unresolved threads, and your interests
- **Graph-based connections:** Understands relationships between people, projects, ideas, and topics - can surface relevant connections during conversation
- **Question selection:** Learns what kinds of questions you find engaging vs. annoying
- **Recovery:** When it asks a bad question, it notices your reaction and adjusts
- **Synthesis:** Can turn transcripts into artifacts (blog posts, plans, technical docs)
- **Semantic search:** Finds related topics, projects, and ideas even when not explicitly named

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
- **Mobile-first:** iOS app, notification triggers, instant recording when opened
- **Voice-first:** Natural conversation via speech-to-text and text-to-speech
- **Text available:** Can read responses on screen when audio isn't appropriate
- **Cloud sync:** Conversations accessible across devices

### What's NOT in MVP
- Calendar/email integration
- All-day transcription
- Proactive notifications without user trigger
- Multiple "modes" - just one excellent system prompt that adapts

### Data Architecture (MVP)

**Dual-database approach for optimal performance:**

**PostgreSQL (Time-series & Full Content):**
- Complete conversation transcripts (JSON)
- Vector embeddings for semantic search across all conversations
- Artifact storage (blog posts, plans, docs created from conversations)

**Neo4j (Structured Knowledge Graph):**
- Entities: People, Projects, Ideas, Topics with rich context properties
- Relationships: Who's involved in what, which topics relate, what blocks what
- Current state only - no historical tracking (keeps graph fast and focused)
- Selective context retrieval - query only relevant properties per conversation
- Embeddings on entities for semantic similarity (find related projects/ideas/topics)

**Key insight:** Neo4j enables intelligent context management. When you mention "Sarah" in conversation, Cosmo can:
1. Query Neo4j for Sarah's core context (relationship type, why she matters, current situation)
2. Traverse graph to find related entities (projects she's involved in, shared topics)
3. Use semantic search to find similar topics or related ideas
4. Pull only what's needed - not the entire history

This keeps conversation context tight and relevant without overwhelming the LLM.

---

## Future Stages

### Stage 2: Proactive Intelligence
- **Smart notifications:** Cosmo suggests when to talk based on your patterns (post-workout, evening wind-down, after social events)
- **Conversation topic sourcing:** Finds relevant events, news, or content and brings it up ("Did you see this new AI model released?")
- **Event awareness:** Knows about upcoming meetings, deadlines, and can prep you
- **External context:** Can search news, look up information during conversations, act as research partner
- **Deeper learning:** Builds sophisticated profile of your communication preferences, energy patterns, and thought processes
- **Background task suggestions:** "Hey, I found this event next week that seems relevant to your interests. Want to go?"

### Stage 3: Life Integration
- **Calendar integration:** Knows your schedule, can help prep for events
- **Email context:** Aware of what's happening in your work/life
- **Multi-modal:** Can view images, documents you're working on
- **Relationship tracking:** Remembers people in your life and your dynamics with them

### Stage 4: Ambient Companion
- **Background awareness:** Can transcribe throughout the day (with explicit permission)
- **Proactive suggestions:** "You haven't talked about X in a while, still thinking about it?"
- **Deep context aggregation:** Rich understanding of your current priorities, relationships, and projects built from all conversations
- **Advanced pattern recognition:** Surfaces subtle contradictions in current beliefs and behaviors based on comprehensive context

---

## Success Metrics

### Engagement
- Daily active usage
- Average conversation length
- Repeat usage (do people come back?)

### Value Delivery
- Conversations that lead to artifacts (blog posts, plans, decisions)
- User reports of insights gained through conversation
- Effective use of past context to make conversations more relevant
- Quality of conversation topic suggestions ("that was exactly what I needed to talk about")

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

### On The Learning System
- When users snap at obvious questions, the system needs to remember and never make that mistake again
- Build profile over time: What topics energize them? What questions land well? What feels like a chore?
- Recovery is critical - when you mess up, acknowledge it and adjust course immediately
- The goal is becoming a better conversation partner over time, like a friend who learns your communication style

---

## Open Questions

1. **How do we avoid the "creepy companion" effect?** Where's the line between helpful and intrusive?

2. **How do we handle sensitive information?** Therapy-level conversations require trust. What's the privacy model?

3. **What's the business model?** Subscription? Per-conversation? Free tier with limits?

4. **How do we ensure conversation quality?** Bad questions ruin the experience. How do we maintain high quality as we scale?

5. **When does memory become overwhelming?** At what point does having years of transcripts become a burden rather than a benefit?