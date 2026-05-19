-- Pi Missions Database Schema
-- Version: 1.0.0

-- Missions table
CREATE TABLE IF NOT EXISTS missions (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT,
    status TEXT NOT NULL DEFAULT 'planning' CHECK(status IN ('planning', 'active', 'paused', 'complete', 'blocked', 'budget_limited')),
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    completed_at INTEGER,
    total_tokens INTEGER DEFAULT 0,
    total_features INTEGER DEFAULT 0,
    features_completed INTEGER DEFAULT 0,
    features_failed INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,
    tags TEXT DEFAULT '[]',
    metadata TEXT DEFAULT '{}'
);

-- Milestones table
CREATE TABLE IF NOT EXISTS milestones (
    id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'complete')),
    sort_order INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    completed_at INTEGER,
    PRIMARY KEY (id, mission_id),
    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);

-- Features table
CREATE TABLE IF NOT EXISTS features (
    id TEXT NOT NULL,
    milestone_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    priority INTEGER DEFAULT 3 CHECK(priority BETWEEN 1 AND 5),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'done', 'blocked', 'failed')),
    depends_on TEXT DEFAULT '[]',
    acceptance_criteria TEXT DEFAULT '[]',
    sessions TEXT DEFAULT '[]',
    tool_call_count INTEGER DEFAULT 0,
    tokens_used INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0,
    blockers TEXT DEFAULT '[]',
    notes TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    started_at INTEGER,
    completed_at INTEGER,
    evidence TEXT,
    PRIMARY KEY (id, mission_id),
    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE,
    FOREIGN KEY (milestone_id, mission_id) REFERENCES milestones(id, mission_id) ON DELETE CASCADE
);

-- Acceptance criteria table
CREATE TABLE IF NOT EXISTS acceptance_criteria (
    id TEXT NOT NULL,
    feature_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    description TEXT NOT NULL,
    check_type TEXT NOT NULL CHECK(check_type IN ('manual', 'bash', 'test_file')),
    check_command TEXT,
    verified INTEGER DEFAULT 0,
    waived INTEGER DEFAULT 0,
    evidence TEXT,
    verified_at INTEGER,
    PRIMARY KEY (id, feature_id, mission_id),
    FOREIGN KEY (feature_id, mission_id) REFERENCES features(id, mission_id) ON DELETE CASCADE
);

-- History table
CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id TEXT NOT NULL,
    feature_id TEXT,
    event TEXT NOT NULL,
    note TEXT,
    details TEXT DEFAULT '{}',
    timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    session_id TEXT,
    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_history_mission ON history(mission_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_history_feature ON history(feature_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_history_event ON history(event, timestamp);

-- Learnings table
CREATE TABLE IF NOT EXISTS learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id TEXT,
    feature_id TEXT,
    type TEXT NOT NULL CHECK(type IN ('success_pattern', 'failure_pattern', 'optimization', 'insight', 'warning')),
    category TEXT,
    insight TEXT NOT NULL,
    confidence REAL DEFAULT 0.5 CHECK(confidence BETWEEN 0.0 AND 1.0),
    applicable_to TEXT DEFAULT '[]',
    context TEXT DEFAULT '{}',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    used_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_learnings_type ON learnings(type, confidence DESC);
CREATE INDEX IF NOT EXISTS idx_learnings_category ON learnings(category);

-- Patterns table
CREATE TABLE IF NOT EXISTS patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT NOT NULL CHECK(pattern_type IN ('tool_sequence', 'error_solution', 'architecture', 'testing', 'performance', 'workflow')),
    name TEXT NOT NULL,
    description TEXT NOT NULL,
    pattern_data TEXT NOT NULL,
    success_count INTEGER DEFAULT 0,
    failure_count INTEGER DEFAULT 0,
    success_rate REAL DEFAULT 0.0,
    avg_duration_ms INTEGER,
    avg_tokens INTEGER,
    example_missions TEXT DEFAULT '[]',
    tags TEXT DEFAULT '[]',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_patterns_type ON patterns(pattern_type, success_rate DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_tags ON patterns(tags);

-- Predictions table
CREATE TABLE IF NOT EXISTS predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id TEXT,
    feature_id TEXT,
    prediction_type TEXT NOT NULL CHECK(prediction_type IN ('success_probability', 'duration_estimate', 'risk_assessment', 'token_estimate')),
    predicted_value REAL NOT NULL,
    actual_value REAL,
    confidence REAL DEFAULT 0.5,
    accuracy REAL,
    model_version TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    validated_at INTEGER,
    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
);

-- Templates table
CREATE TABLE IF NOT EXISTS templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    author TEXT,
    version TEXT DEFAULT '1.0.0',
    content TEXT NOT NULL,
    tags TEXT DEFAULT '[]',
    difficulty TEXT DEFAULT 'intermediate' CHECK(difficulty IN ('beginner', 'intermediate', 'advanced')),
    estimated_time_hours REAL,
    estimated_tokens INTEGER,
    usage_count INTEGER DEFAULT 0,
    rating REAL DEFAULT 0.0,
    rating_count INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    is_builtin INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_templates_tags ON templates(tags);
CREATE INDEX IF NOT EXISTS idx_templates_rating ON templates(rating DESC, usage_count DESC);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    mission_id TEXT,
    feature_id TEXT,
    started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    ended_at INTEGER,
    tokens_used INTEGER DEFAULT 0,
    tool_calls INTEGER DEFAULT 0,
    errors INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'completed', 'abandoned')),
    FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_mission ON sessions(mission_id, started_at);

-- Metrics table
CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    metric_type TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT,
    tags TEXT DEFAULT '{}',
    recorded_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    period_start INTEGER,
    period_end INTEGER
);

CREATE INDEX IF NOT EXISTS idx_metrics_type ON metrics(metric_type, metric_name, recorded_at);
CREATE INDEX IF NOT EXISTS idx_metrics_period ON metrics(period_start, period_end);

-- Plugins table
CREATE TABLE IF NOT EXISTS plugins (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    version TEXT NOT NULL,
    description TEXT,
    author TEXT,
    enabled INTEGER DEFAULT 1,
    config TEXT DEFAULT '{}',
    installed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Views
CREATE VIEW IF NOT EXISTS mission_summary AS
SELECT 
    m.id,
    m.title,
    m.status,
    m.created_at,
    m.completed_at,
    m.total_tokens,
    m.total_features,
    m.features_completed,
    m.features_failed,
    CASE 
        WHEN m.total_features > 0 
        THEN ROUND(CAST(m.features_completed AS REAL) / m.total_features * 100, 1)
        ELSE 0 
    END as progress_percent,
    COUNT(DISTINCT s.id) as session_count,
    COALESCE(SUM(s.tokens_used), 0) as session_tokens
FROM missions m
LEFT JOIN sessions s ON s.mission_id = m.id
GROUP BY m.id;

CREATE VIEW IF NOT EXISTS feature_details AS
SELECT 
    f.id,
    f.mission_id,
    f.milestone_id,
    f.title,
    f.status,
    f.priority,
    f.tool_call_count,
    f.tokens_used,
    f.error_count,
    f.started_at,
    f.completed_at,
    CASE 
        WHEN f.started_at IS NOT NULL AND f.completed_at IS NOT NULL 
        THEN f.completed_at - f.started_at
        WHEN f.started_at IS NOT NULL 
        THEN (unixepoch() * 1000) - f.started_at
        ELSE NULL 
    END as duration_ms,
    m.title as mission_title,
    ms.title as milestone_title
FROM features f
JOIN missions m ON m.id = f.mission_id
JOIN milestones ms ON ms.id = f.milestone_id AND ms.mission_id = f.mission_id;

CREATE VIEW IF NOT EXISTS active_missions AS
SELECT * FROM mission_summary 
WHERE status IN ('active', 'paused', 'budget_limited')
ORDER BY updated_at DESC;

-- Default templates
INSERT OR IGNORE INTO templates (id, name, description, author, version, content, tags, difficulty, estimated_time_hours, estimated_tokens, is_builtin)
VALUES 
(
    'refactor',
    'Code Refactoring',
    'Systematic code refactoring with tests',
    'pi-missions',
    '1.0.0',
    '{"milestones":[{"id":"M01","title":"Analysis","features":[{"id":"F001","title":"Analyze current code","priority":1},{"id":"F002","title":"Identify refactoring targets","priority":1}]},{"id":"M02","title":"Refactoring","features":[{"id":"F003","title":"Refactor core logic","priority":2},{"id":"F004","title":"Update tests","priority":2}]},{"id":"M03","title":"Verification","features":[{"id":"F005","title":"Run full test suite","priority":1}]}]}',
    '["refactoring","cleanup","quality"]',
    'intermediate',
    4.0,
    50000,
    1
),
(
    'add-feature',
    'New Feature',
    'Add a new feature to existing codebase',
    'pi-missions',
    '1.0.0',
    '{"milestones":[{"id":"M01","title":"Planning","features":[{"id":"F001","title":"Design feature","priority":1},{"id":"F002","title":"Plan implementation","priority":1}]},{"id":"M02","title":"Implementation","features":[{"id":"F003","title":"Implement feature","priority":2},{"id":"F004","title":"Write tests","priority":2}]},{"id":"M03","title":"Integration","features":[{"id":"F005","title":"Integration testing","priority":1},{"id":"F006","title":"Documentation","priority":3}]}]}',
    '["feature","development","new"]',
    'intermediate',
    6.0,
    75000,
    1
),
(
    'fix-bug',
    'Bug Fix',
    'Systematic bug investigation and fix',
    'pi-missions',
    '1.0.0',
    '{"milestones":[{"id":"M01","title":"Investigation","features":[{"id":"F001","title":"Reproduce bug","priority":1},{"id":"F002","title":"Root cause analysis","priority":1}]},{"id":"M02","title":"Fix","features":[{"id":"F003","title":"Implement fix","priority":1},{"id":"F004","title":"Write regression test","priority":1}]},{"id":"M03","title":"Verification","features":[{"id":"F005","title":"Verify fix works","priority":1}]}]}',
    '["bugfix","debugging","fix"]',
    'beginner',
    2.0,
    25000,
    1
);
