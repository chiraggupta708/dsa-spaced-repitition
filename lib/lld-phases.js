export const LLD_ATTEMPT_PHASES = Object.freeze([
  {
    key: 'functional_requirements',
    label: 'Functional requirements',
    prompt: 'As the candidate, list the observable user and system behaviors this system must support. Use actor-plus-verb statements and include the important success and rejection outcomes.',
    judge: 'Observable behavior: actors, user/system actions, state changes, returned outcomes, business rules, authorization boundaries, and explicit scope exclusions.',
    ignore: 'Do not judge latency, throughput, availability, consistency, durability, security posture, concurrency, observability, classes, interfaces, patterns, or implementation choices in this checkpoint.',
    rubric: [
      'Names the relevant actors or callers and the system boundary.',
      'Describes observable actions and resulting state or response, not classes or implementation mechanisms.',
      'Covers the important happy-path behavior and at least one meaningful rejection or failure outcome.',
      'States a deliberate v1 scope boundary without inventing unrelated features.',
    ],
    checks: [
      { patterns: ['user', 'actor', 'client', 'system', 'operator', 'admin'], message: 'Name who performs the action or receives the result.' },
      { patterns: ['can ', 'create', 'add', 'select', 'choose', 'submit', 'record', 'view', 'return', 'borrow', 'park', 'pay', 'send', 'search'], message: 'Describe an observable action the system must support.' },
      { patterns: ['show', 'return', 'update', 'record', 'reject', 'deny', 'fail', 'error', 'unavailable', 'invalid'], message: 'State the resulting outcome or an important rejection path.' },
    ],
    followUp: 'Which user-visible behavior must be rejected, and what should the caller observe when it is rejected?',
  },
  {
    key: 'nfr',
    label: 'Non-functional requirements',
    prompt: 'As the candidate, state the guarantees and constraints that define quality for this system. Make each NFR measurable or testable where possible, and state which ones matter for the chosen v1 scope.',
    judge: 'Quality guarantees and constraints: latency, throughput/capacity, availability, consistency, durability, security, concurrency, idempotency, observability, and operational limits only when relevant to this problem.',
    ignore: 'Do not judge whether the candidate listed every functional feature, named entities/classes, selected patterns, or described implementation flows in this checkpoint.',
    rubric: [
      'Selects the few quality dimensions that matter for this problem instead of dumping a generic checklist.',
      'States a measurable target, constraint, invariant, or testable guarantee for each selected dimension.',
      'Connects the guarantee to the risk or user impact it protects.',
      'Calls out important v1 tradeoffs or explicitly deferred quality concerns.',
    ],
    checks: [
      { patterns: ['latency', 'ms', 'p95', 'p99', 'response time', 'throughput', 'rps', 'capacity', 'qps'], message: 'Choose a relevant performance or capacity constraint and make it measurable.' },
      { patterns: ['availability', 'uptime', 'consistency', 'durability', 'security', 'authoriz', 'authent', 'concurr', 'idempot', 'observab', 'metric', 'log', 'alert', 'retention'], message: 'Name a relevant reliability, correctness, security, concurrency, or observability guarantee.' },
    ],
    followUp: 'Which quality guarantee is most important for this system, and what failure would violate it?',
  },
  {
    key: 'model',
    label: 'Model and responsibilities',
    prompt: 'Name the core objects, one responsibility for each, and who owns mutable state.',
    judge: 'Classes, responsibilities, relationships, ownership, mutable state, and protected invariants.',
    ignore: 'Do not re-grade functional coverage or NFR coverage unless the candidate explicitly uses them to justify ownership.',
    rubric: [
      'Names the core domain objects without turning requirements into implementation plumbing.',
      'Gives each object one clear responsibility and identifies the mutable-state owner.',
      'Names the invariant or invalid transition that the owner protects.',
    ],
    checks: [
      { patterns: ['class', 'object', 'entity'], message: 'Name the core classes or objects.' },
      { patterns: ['respons', 'own', 'ownership'], message: 'Give each object one responsibility and a clear owner.' },
      { patterns: ['state', 'mutable', 'invariant'], message: 'Identify mutable state and the invariant it protects.' },
    ],
    followUp: 'Which object owns the mutable state, and what invalid transition must it reject?',
  },
  {
    key: 'code',
    label: 'Java classes and method contracts',
    prompt: 'Sketch the Java classes or interfaces, their ownership, and the method signatures that protect the main invariants.',
    judge: 'Java boundaries, method inputs/outputs, failure behavior, state transitions, and compile-friendly structure.',
    ignore: 'Do not penalize missing requirements or NFRs here unless they directly change a method contract or invariant.',
    rubric: [
      'Uses a small set of Java classes/interfaces with clear reasons to change.',
      'Gives important methods inputs, outputs, and failure behavior.',
      'Connects methods to the state transition or invariant they protect.',
    ],
    checks: [
      { patterns: ['class', 'interface'], message: 'Name the Java class or interface boundaries.' },
      { patterns: ['method', 'signature', 'public ', 'private '], message: 'Give the important methods inputs, outputs, and failure behavior.' },
      { patterns: ['invariant', 'state', 'exception', 'error'], message: 'Connect each method to the invariant or state transition it protects.' },
    ],
    followUp: 'Which class or interface should change when the next policy variation is added?',
  },
  {
    key: 'diagram',
    label: 'Relationships and diagram',
    prompt: 'Explain the important relationships and how your diagram makes ownership visible.',
    judge: 'Relationships, direction, multiplicity, ownership, and dependencies represented in the diagram.',
    ignore: 'Do not re-grade the requirements or NFR checklist in this checkpoint.',
    rubric: [
      'Shows the relationships that affect behavior rather than every field or getter.',
      'Makes direction, multiplicity, and ownership meaningful where they affect behavior.',
      'Keeps the diagram consistent with the responsibilities already stated.',
    ],
    checks: [
      { patterns: ['diagram', 'classdiagram', 'sequencediagram'], message: 'Describe what the diagram makes visible.' },
      { patterns: ['relation', 'inherit', 'composition', 'association', 'depend'], message: 'Explain the important relationships and dependencies.' },
      { patterns: ['own', 'respons', 'boundary'], message: 'Show where ownership or responsibility crosses an object boundary.' },
    ],
    followUp: 'Which relationship is the ownership boundary, and what call crosses it first?',
  },
  {
    key: 'flow_tradeoffs',
    label: 'Primary flow and tradeoffs',
    prompt: 'Walk through the happy path, one failure path, and one deliberate tradeoff.',
    judge: 'State transitions, flow ownership, failure/retry behavior, and an explicit design tradeoff.',
    ignore: 'Do not ask the candidate to repeat the full functional or NFR checklist; use those decisions only as flow constraints.',
    rubric: [
      'Walks from request to final state through one owner/orchestrator.',
      'Explains one failure or retry path and the safe resulting state.',
      'Names one deliberate tradeoff and the guarantee it protects.',
    ],
    checks: [
      { patterns: ['happy', 'success', 'normal flow'], message: 'Walk through the happy path from request to final state.' },
      { patterns: ['failure', 'error', 'exception', 'retry'], message: 'Walk through one failure or retry path and its safe state.' },
      { patterns: ['tradeoff', 'latency', 'consistency', 'availability', 'state'], message: 'Name one deliberate tradeoff and what it protects.' },
    ],
    followUp: 'Where does the failure stop, and what state is safe to observe after a retry?',
  },
  {
    key: 'review',
    label: 'Edge cases and extensibility',
    prompt: 'Name the highest-risk edge case, one extension, and the next thing you would test.',
    judge: 'Edge cases, extension seams, production risks, and a concrete verification plan.',
    ignore: 'Do not reopen settled functional/NFR checkpoints unless the edge case exposes a specific contradiction.',
    rubric: [
      'Names the highest-risk edge case rather than listing generic possibilities.',
      'Identifies the smallest safe extension point or policy variation.',
      'Names a test or operational signal that would catch the failure.',
    ],
    checks: [
      { patterns: ['edge', 'corner', 'invalid', 'duplicate', 'concurr'], message: 'Name the highest-risk edge case.' },
      { patterns: ['extend', 'extension', 'change', 'policy'], message: 'Add one likely extension and identify its smallest safe change.' },
      { patterns: ['test', 'verify', 'observ', 'log', 'metric'], message: 'Name one test or operational signal that would catch a failure.' },
    ],
    followUp: 'What is the highest-risk edge case, and which test would fail if you missed it?',
  },
]);

export const LLD_LEGACY_PHASE_KEYS = Object.freeze(['scope']);
export const LLD_PHASE_KEYS = new Set([
  ...LLD_ATTEMPT_PHASES.map((phase) => phase.key),
  ...LLD_LEGACY_PHASE_KEYS,
]);

const LEGACY_SCOPE_PHASE = Object.freeze({
  key: 'scope',
  label: 'Requirements and scope (legacy)',
  prompt: 'Legacy checkpoint. Evaluate the saved combined requirements and scope notes without using this for new attempts.',
  judge: 'Legacy combined functional requirements, NFRs, assumptions, and scope boundaries.',
  ignore: 'This legacy checkpoint is retained only so old attempts can still be read.',
  rubric: [],
  checks: [
    { patterns: ['requirement', 'functional', 'user can', 'accepts'], message: 'State the functional requirements and observable state changes.' },
    { patterns: ['nfr', 'non-functional', 'latency', 'availability', 'consistency', 'performance', 'reliab', 'scalab', 'security'], message: 'Name the key NFRs and what they constrain.' },
    { patterns: ['assum', 'constraint', 'actor', 'limit'], message: 'List the main assumptions and constraints.' },
    { patterns: ['out of scope', 'exclude', 'not support', 'boundary'], message: 'State what is explicitly out of scope.' },
  ],
  followUp: 'Which requirement or NFR would change your object ownership if it became stricter?',
});

export function getLldPhase(phaseKey) {
  return LLD_ATTEMPT_PHASES.find((phase) => phase.key === phaseKey) ||
    (phaseKey === 'scope' ? LEGACY_SCOPE_PHASE : null);
}
