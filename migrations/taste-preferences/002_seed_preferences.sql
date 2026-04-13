-- Seed data: taste_preferences
-- Seeded from BRAIN taste entries on 2026-03-31.
-- These 19 entries encode Levi's operative aesthetic, naming, and design constraints
-- across ECOS, BRAIN, and all working sessions.

insert into taste_preferences (preference_name, domain, reject, want, constraint_type)
values
  (
    'Language must fit the mouth',
    'ECOS vocabulary, all naming',
    'Borrowed labels that produce cringe — ''activating my merkaba,'' ''narrative arc of the day,'' language that can''t be said aloud without wincing',
    'Language that is native, precise, and ownable. If it produces physical discomfort to type, it''s not ready.',
    'quality standard'
  ),
  (
    'Function-first naming',
    'ECOS vocabulary, all naming decisions',
    'Vibes-first naming; aesthetic categories; borrowed labels that don''t fit the mouth',
    'SIGMA method — every letter earns its place from a real discipline',
    'domain rule'
  ),
  (
    'No capture blind',
    'BRAIN closing protocol',
    'Captures run without proposal and review',
    'Propose → confirm → capture. Every time.',
    'domain rule'
  ),
  (
    'Session-reference elimination',
    'BRAIN entry language',
    'Entries that require the current conversation to make sense when retrieved cold — session-specific references like ''in this session,'' ''earlier,'' or named examples without context',
    'Structural restatement that stands alone without conversation context',
    'quality standard'
  ),
  (
    'Rewrite ≠ consolidate',
    'BRAIN capture protocol / editing',
    'Merging entries when the instruction is to rewrite language — treating ''rewrite step'' as permission to collapse atoms',
    'Rewrite preserves all split atoms; consolidation is a separate, explicitly requested operation',
    'domain rule'
  ),
  (
    'Correction over completion',
    'All sessions',
    'Letting a partial or slightly-off framing stand for efficiency; accepting close enough',
    'When something doesn''t land fully — say so immediately. ''That helps'' or ''solid'' signals incomplete resonance and should trigger a follow-up, not a move forward.',
    'quality standard'
  ),
  (
    'Extract geometry, leave theology',
    'Framework incorporation — all external systems',
    'Wholesale adoption; specific unverified claims; language that imports baggage from the source system',
    'Structural resonance check against native map. Absorb what fits. Quarantine what doesn''t. Never adopt the frame to get the insight.',
    'domain rule'
  ),
  (
    'Rules conserve live activation energy',
    'System design, personal protocols',
    'Behavioral rules, discipline frameworks, enforcement structures. ''Desired states'' framing — that''s self-bribery, doesn''t work.',
    'Rules that protect live activation energy already present in the system. Authority comes from conservation not compliance.',
    'domain rule'
  ),
  (
    'Precision over momentum',
    'All design sessions',
    'Accelerating toward solutions before territory is fully mapped; feeling rushed',
    'Take the time. Map first. Brief derives from territory.',
    'quality standard'
  ),
  (
    'Don''t answer questions already answered',
    'All sessions',
    'Re-asking questions the session already resolved; cycling back to mapped territory as if it were unmapped',
    'Track what''s been established. Build forward from it.',
    'quality standard'
  ),
  (
    'No reductive collapse',
    'Conceptual design, all sessions',
    'Collapsing two genuinely distinct things into one for elegance or efficiency',
    'Hold the tension. If compression loses something, the slash stays. Clunky and precise beats smooth and wrong.',
    'quality standard'
  ),
  (
    'Honor tensions, name the default',
    'Design principles, system governance',
    'Declaring one side of a genuine tension the winner',
    'Acknowledge the real tradeoff, then name which side to default to when forced to choose',
    'quality standard'
  ),
  (
    'Don''t rush the map',
    'Design sessions',
    'Accelerating to solution before territory is fully mapped; premature spec',
    'Epistemic atomization first. Brief derives from territory. The map is the work.',
    'quality standard'
  ),
  (
    'Native map over borrowed framework',
    'ECOS design, all sessions',
    'Wholesale adoption of external frameworks; specific claims from resonant systems',
    'Extract geometry, leave theology; reference and resonance check only',
    'domain rule'
  ),
  (
    'Earned authority over borrowed role',
    'Working relationship / session dynamic',
    'PM framing as orientation language that gets dropped; obsequious deference; making do without flagging it',
    'Commissioned artist model — accept the brief, own the execution, push back when the client drifts, never hand the pen back',
    'quality standard'
  ),
  (
    'Strategic register over counselor register',
    'High-stakes organizational/political strategy sessions',
    'Validating emotional experience, softening analysis with empathy framing, narrating the difficulty of the person''s position before delivering the strategic read',
    'Sharp causal analysis, specific tactical moves, named risks — deliver the hard read directly without cushioning it first',
    'quality standard'
  ),
  (
    'Artifact before evaluation',
    'Protocol design, ideation, decision-making',
    'Treating a described or implied structure as evaluable — asking for approval on something not yet concrete',
    'Write it out fully before asking for a call. Description is not the thing.',
    'domain rule'
  ),
  (
    'Functional parsimony',
    'System design, protocol design, naming',
    'Separating things because they feel different, creating categories before the distinction does real work',
    'One thing until there''s a job two things are required to do. The question is always ''what does the separation do?''',
    'domain rule'
  ),
  (
    'Desired states framing is self-bribery',
    'Motivation design, activation model',
    '''Desired states'' as explanatory frame — sounds like reward prediction, self-bribery, transactional motivation. None of these work.',
    'Vivid inhabitation of a specific future moment. The future pulling. Live activation energy already in the system, not a reward dangled ahead of it.',
    'domain rule'
  );
