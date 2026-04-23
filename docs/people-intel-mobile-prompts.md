# People-Intelligence — claude.ai Mobile Prompt Library
*Optimized for thumb-typing, no tool access, memory-native retrieval*

---

## Design Principles

These prompts work directly with claude.ai's memory system. No file access, no MCP tools, no structured output required. Optimized for:
- Short enough to type on mobile
- Copy-paste friendly (fill one bracket, send)
- Works mid-conversation without context reset
- Captures go into claude.ai memory; extractions pull from it

---

## Capture Prompts
*Use immediately after an interaction or observation*

### Quick observation
```
Note for [Name]: [one sentence observation]. Save this.
```

### Typed observation
```
Note for [Name] — [fact|observation|interpretation|strategy]:
[one sentence]
Confidence: [1-5]. Domain: [tango|ttc|personal|business].
Save this.
```

### Post-conversation debrief
```
I just talked with [Name] about [topic]. Key things I noticed:
- [bullet]
- [bullet]

Extract these into separate memory notes. One claim per note. Save each.
```

### Pattern update
```
Update my read on [Name]: [new interpretation].
This supersedes: [what it replaces, or "nothing prior"].
Confidence: [1-5]. Save this.
```

### Strategy note
```
Strategy for [Name]: [one sentence on what to do].
Context: [brief why]. Save this.
```

---

## Retrieval Prompts
*Pull from memory before an interaction*

### Quick recall
```
What do you know about [Name]?
```

### Pre-meeting brief
```
I'm about to [call/meet] [Name] about [topic].
What do you know about them? Focus on: patterns, posture, open items.
```

### Domain-scoped recall
```
What do you know about [Name] in the context of [tango|TTC|business]?
```

### Relationship status
```
Current status with [Name]? Administrative? Active? Any open issues?
```

### Strategic posture
```
What's my recommended posture with [Name] right now?
Pull from everything you know.
```

---

## Analysis Prompts
*Work with existing memory to draw conclusions*

### Pattern surfacing
```
What patterns have I noted about [Name] across different situations?
```

### Cross-person
```
What do you know about [Name1] and [Name2]?
Do they interact? Any dynamics I should be aware of?
```

### Staleness check
```
What's the most recent thing you know about [Name]?
Is anything I've noted about them likely to be outdated?
```

### Confidence audit
```
For [Name]: which of your memories about them feel most solid vs. speculative?
Separate high-confidence from low-confidence.
```

---

## Extraction Prompts
*Pull structured data for import into Claude Code*

### Full person dump (feeds extraction template)
```
Export everything you know about [Name].
Format each item as:
TYPE: [fact|observation|interpretation|hypothesis|strategy]
DOMAIN: [domain]
CONFIDENCE: [1-5]
TEMPORAL: [when / unclear]
CURRENT: [yes|no|uncertain]
CONTENT: [standalone statement, third person]

One item per block. No preamble.
```

### Delta extraction (new items since last sync)
```
What have I told you about [Name] since [rough date / "last time we discussed them"]?
Format same as full dump. New items only.
```

---

## Utility Prompts
*Situational, low-friction captures*

### Flag for later
```
Flag this for my next Claude Code session: [one sentence].
```

### Quick decision log
```
Decision made: [decision]. Context: [brief]. About: [Name if relevant]. Save this.
```

### Relationship signal
```
[Name] just [action/said/did]. 
Does this match or break the patterns you have on them?
```

### Pre-board / pre-event
```
I have a TTC [meeting|event] [today/tomorrow].
Who from TTC is involved? What do you know about each person's current posture?
```

---

## Sync Prompts
*Bridge between claude.ai and Claude Code*

### Prep a sync session
```
I'm about to sync you with Claude Code. 
List everything new or updated you have on [Name] since [date].
Use the extraction format (TYPE / DOMAIN / CONFIDENCE / TEMPORAL / CURRENT / CONTENT).
```

### Flag for BRAIN cleanup
```
Which of your memories about [Name] feel potentially stale, duplicated, or fused?
Flag them with why. I'll review in Claude Code.
```

### What changed
```
Since we last worked on [Name]'s profile, what new things have I told you about them?
Short list, no formatting needed.
```
