import type {
  Action,
  AdjustmentSubloop,
  AuthoritativePhase,
  Handle,
  InstalledShape,
  Interaction,
  LoopStatus,
  MetabolizeState,
  MoveCustody,
  MovePosition,
  RuntimeRequest,
  SenseState,
  ShapeContent,
  ShapeProposal,
  VerificationResult,
} from "./contracts.ts";
import { verificationResults } from "./contracts.ts";

export type MainLoopState = {
  loop_id: string | null;
  loop_status: LoopStatus;
  authoritative_phase: AuthoritativePhase;
  current_step: string;
  working_state: Record<string, unknown>;
  purpose_handle: Handle;
  orientation_handle: Handle;
  sense_state: SenseState;
  shape_proposals: ShapeProposal[];
  proposed_shape: ShapeProposal | null;
  installed_shape: InstalledShape | null;
  move_custody: MoveCustody | null;
  active_adjustment: AdjustmentSubloop | null;
  metabolize_state: MetabolizeState | null;
  no_active_reason: string;
};

export type RuntimeEvent = {
  event_type: string;
  actor: "levi" | "runtime" | "system";
  perspective: string;
  payload: Record<string, unknown>;
};

export type Transition = {
  events: RuntimeEvent[];
  next: MainLoopState;
  interaction: Interaction;
  available_actions: Action[];
  correction_action: Action | null;
  close_loop?: boolean;
};

const now = () => new Date().toISOString();
const text = (value: unknown) => String(value ?? "").trim();
const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean)
    : [];
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};

const requirePhase = (
  state: MainLoopState,
  allowed: AuthoritativePhase[],
) => {
  if (!allowed.includes(state.authoritative_phase)) {
    throw new Error("action_not_available");
  }
};

const requireMove = (state: MainLoopState) => {
  requirePhase(state, ["move"]);
  if (!state.installed_shape || !state.move_custody) {
    throw new Error("move_custody_incomplete");
  }
};

const withProposalStatus = (
  proposals: ShapeProposal[],
  id: string,
  proposal_status: ShapeProposal["proposal_status"],
) =>
  proposals.map((proposal) =>
    proposal.id === id ? { ...proposal, proposal_status } : proposal
  );

const createProposal = (
  state: MainLoopState,
  shape: ShapeContent,
): ShapeProposal => ({
  id: crypto.randomUUID(),
  proposal_version: Math.max(
    0,
    ...state.shape_proposals.map((proposal) => proposal.proposal_version),
  ) + 1,
  proposal_content: shape,
  machine_interpretation: {
    sense_completion_basis: state.sense_state.sense_completion_basis,
    field_representation: state.sense_state.field_representation,
  },
  proposal_status: "proposed",
  created_at: now(),
});

const toInstalledShape = (
  proposal: ShapeProposal,
  request: RuntimeRequest,
): InstalledShape => ({
  ...proposal.proposal_content,
  accepted_proposal_id: proposal.id,
  accepted_by: "levi",
  accepted_at: now(),
  installation_actions: [],
  installation_status: "pending",
  installed_at: null,
  declared_starting_conditions: text(
    request.input.declared_starting_conditions,
  ),
  small_move_exception: request.input.small_move_exception === true,
  installation_waiver: null,
  transition_event_identifier: null,
  shape_version: proposal.proposal_version,
});

const beginMetabolize = (
  state: MainLoopState,
  disposition: string,
): MetabolizeState => ({
  move_disposition: disposition,
  exit_condition_snapshot: state.installed_shape?.exit_condition ?? "",
  completion_claim_snapshot: state.move_custody?.completion_claim ?? null,
  verification_result: null,
  verification_assessment: null,
  credited_result: null,
  consequences: [],
  residue: null,
  released_material: [],
  lessons: [],
  closure_basis: null,
  residue_confirmed: false,
});

const senseInteraction = (state: MainLoopState): Interaction => {
  const residue = state.sense_state.inherited_residue
    ? `\nConditioned residue from the prior loop: ${
      JSON.stringify(state.sense_state.inherited_residue)
    }\nEncounter it as changed field evidence, not as a preselected Move.`
    : "";
  return {
    kind: "question",
    prompt: state.sense_state.grounded_inputs.length === 0
      ? `What is concretely true in your body, surroundings, time, obligations, and present field?${residue}`
      : "What remains materially unknown or constrained before a useful Shape attempt?",
    input_mode: "dictation_or_text",
    choices: ["Enough grounded input to attempt Shape"],
  };
};

const shapeInteraction = (state: MainLoopState): Interaction => {
  if (state.proposed_shape) {
    return {
      kind: "shape",
      prompt: renderShape(state.proposed_shape),
      input_mode: "choice",
      choices: [
        "Accept proposal",
        "Correct proposal",
        "Reject proposal",
        "Generate another proposal",
      ],
    };
  }
  if (state.installed_shape?.installation_status !== "installed") {
    return {
      kind: "choice",
      prompt:
        "The Shape is accepted but not yet installed. Complete or explicitly waive the declared installation requirements before Move.",
      input_mode: "choice",
      choices: ["Record installation action", "Confirm installed"],
    };
  }
  return {
    kind: "question",
    prompt: "Shape requires another persisted proposal.",
    input_mode: "dictation_or_text",
    choices: [],
  };
};

const metabolizeInteraction = (state: MainLoopState): Interaction => ({
  kind: state.metabolize_state?.residue_confirmed ? "choice" : "question",
  prompt: state.metabolize_state?.residue_confirmed
    ? "Conditioned residue is confirmed. Close or dispose this loop?"
    : "What landed when compared with the installed Shape, orientation, exit condition, and available evidence?",
  input_mode: state.metabolize_state?.residue_confirmed
    ? "choice"
    : "dictation_or_text",
  choices: state.metabolize_state?.residue_confirmed
    ? ["Close loop"]
    : ["Record assessment", "Confirm residue"],
});

export function surfaceForState(state: MainLoopState): {
  interaction: Interaction;
  available_actions: Action[];
  correction_action: Action | null;
} {
  if (state.authoritative_phase === "unknown") {
    return {
      interaction: {
        kind: "recovery",
        prompt:
          "The authoritative state is uncertain. Review the latest trustworthy records, then recover or dispose this loop. A new loop will not be created silently.",
        input_mode: "choice",
        choices: ["Recover a phase", "Dispose through Metabolize"],
      },
      available_actions: ["recover_authoritative_state"],
      correction_action: "recover_authoritative_state",
    };
  }
  if (state.authoritative_phase === "sense") {
    return {
      interaction: senseInteraction(state),
      available_actions: [
        "submit_sense_input",
        "request_shape_proposal",
        "recover_authoritative_state",
      ],
      correction_action: "submit_sense_input",
    };
  }
  if (state.authoritative_phase === "shape") {
    const installation = state.installed_shape &&
      state.installed_shape.installation_status !== "installed";
    return {
      interaction: shapeInteraction(state),
      available_actions: installation
        ? [
          "record_installation_action",
          "confirm_shape_installed",
          "recover_authoritative_state",
        ]
        : [
          "request_shape_proposal",
          "correct_shape_proposal",
          "reject_shape_proposal",
          "accept_shape_proposal",
          "recover_authoritative_state",
        ],
      correction_action: installation
        ? "record_installation_action"
        : "correct_shape_proposal",
    };
  }
  if (state.authoritative_phase === "move") {
    return {
      interaction: {
        kind: "cockpit",
        prompt: renderMoveCockpit(state),
        input_mode: "choice",
        choices: [
          "Resume Move",
          "Record progress",
          "Work through friction",
          "Record interruption",
          "Report changed conditions",
          "Claim completion",
          "Release Move",
          "Abandon Move",
          "State appears wrong",
        ],
      },
      available_actions: [
        "resume_move",
        "record_move_progress",
        "request_move_help",
        "record_move_interruption",
        "report_changed_conditions",
        "classify_change",
        "claim_completion",
        "release_move",
        "abandon_move",
        "recover_authoritative_state",
      ],
      correction_action: "report_changed_conditions",
    };
  }
  return {
    interaction: metabolizeInteraction(state),
    available_actions: [
      "submit_completion_evidence",
      "submit_metabolize_input",
      "confirm_residue",
      "close_loop",
      "recover_authoritative_state",
    ],
    correction_action: "submit_metabolize_input",
  };
}

export function transition(
  request: RuntimeRequest,
  state: MainLoopState,
  generatedShape: ShapeContent | null = null,
): Transition {
  switch (request.action) {
    case "open_current_surface": {
      const isNew = state.working_state.unpersisted === true;
      const surface = surfaceForState(state);
      return {
        events: isNew
          ? [
            {
              event_type: "loop_created",
              actor: "system",
              perspective: "lr_system_evidence",
              payload: {
                no_active_reason: state.no_active_reason,
                inherited_residue: state.sense_state.inherited_residue,
              },
            },
            {
              event_type: "sense_started",
              actor: "system",
              perspective: "lr_system_evidence",
              payload: {
                inherited_residue: state.sense_state.inherited_residue,
              },
            },
          ]
          : [{
            event_type: "loop_resumed",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: {
              authoritative_phase: state.authoritative_phase,
              current_step: state.current_step,
            },
          }],
        next: {
          ...state,
          working_state: { ...state.working_state, unpersisted: false },
        },
        ...surface,
      };
    }

    case "submit_sense_input": {
      requirePhase(state, ["sense"]);
      const grounded = text(request.input.grounded_input);
      if (!grounded) throw new Error("grounded_input_required");
      const inputRecord = {
        grounded_input: grounded,
        present_conditions: request.input.present_conditions ?? null,
        salient_demand: request.input.salient_demand ?? null,
        changed_conditions: request.input.changed_conditions ?? null,
        recorded_at: now(),
      };
      const next: MainLoopState = {
        ...state,
        current_step: "sense_grounding",
        sense_state: {
          ...state.sense_state,
          grounded_inputs: [...state.sense_state.grounded_inputs, inputRecord],
          field_representation: {
            ...state.sense_state.field_representation,
            ...record(request.input.field_representation),
          },
          uncertainties: [
            ...state.sense_state.uncertainties,
            ...stringArray(request.input.uncertainties),
          ],
          material_constraints: [
            ...state.sense_state.material_constraints,
            ...stringArray(request.input.material_constraints),
          ],
          purpose_orientation_context: {
            ...state.sense_state.purpose_orientation_context,
            ...record(request.input.purpose_orientation_context),
          },
        },
      };
      return {
        events: [{
          event_type: "sense_input_recorded",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: inputRecord,
        }, {
          event_type: "sense_field_updated",
          actor: "runtime",
          perspective: "proposal",
          payload: {
            field_representation: next.sense_state.field_representation,
            uncertainties: next.sense_state.uncertainties,
            material_constraints: next.sense_state.material_constraints,
          },
        }],
        next,
        interaction: senseInteraction(next),
        available_actions: [
          "submit_sense_input",
          "request_shape_proposal",
          "recover_authoritative_state",
        ],
        correction_action: "submit_sense_input",
      };
    }

    case "request_shape_proposal": {
      requirePhase(state, ["sense", "shape"]);
      if (!generatedShape) throw new Error("shape_generation_required");
      const completionBasis = text(request.input.sense_completion_basis);
      if (
        state.authoritative_phase === "sense" &&
        (!completionBasis || state.sense_state.grounded_inputs.length === 0)
      ) {
        throw new Error("sense_completion_basis_required");
      }
      const proposal = createProposal({
        ...state,
        sense_state: {
          ...state.sense_state,
          sense_completion_basis: completionBasis ||
            state.sense_state.sense_completion_basis,
        },
      }, generatedShape);
      const priorProposals = state.proposed_shape
        ? withProposalStatus(
          state.shape_proposals,
          state.proposed_shape.id,
          "superseded",
        )
        : state.shape_proposals;
      const next: MainLoopState = {
        ...state,
        authoritative_phase: "shape",
        current_step: "shape_review",
        sense_state: {
          ...state.sense_state,
          sense_completion_basis: completionBasis ||
            state.sense_state.sense_completion_basis,
        },
        shape_proposals: [...priorProposals, proposal],
        proposed_shape: proposal,
      };
      return {
        events: [
          ...(state.authoritative_phase === "sense"
            ? [{
              event_type: "sense_completed",
              actor: "levi" as const,
              perspective: "decision",
              payload: { completion_basis: completionBasis },
            }]
            : [{
              event_type: "shape_proposal_regenerated",
              actor: "runtime" as const,
              perspective: "proposal",
              payload: { prior_proposal_id: state.proposed_shape?.id ?? null },
            }]),
          {
            event_type: "shape_proposal_created",
            actor: "runtime",
            perspective: "proposal",
            payload: { proposal },
          },
        ],
        next,
        interaction: shapeInteraction(next),
        available_actions: [
          "accept_shape_proposal",
          "correct_shape_proposal",
          "reject_shape_proposal",
          "request_shape_proposal",
        ],
        correction_action: "correct_shape_proposal",
      };
    }

    case "correct_shape_proposal": {
      requirePhase(state, ["shape"]);
      if (!state.proposed_shape) throw new Error("no_shape_proposal");
      const correction = text(request.input.correction);
      if (!correction) throw new Error("shape_correction_required");
      if (!generatedShape) throw new Error("shape_generation_required");
      const prior = {
        ...state.proposed_shape,
        proposal_status: "superseded" as const,
      };
      const proposal = createProposal(state, generatedShape);
      const next: MainLoopState = {
        ...state,
        shape_proposals: [
          ...withProposalStatus(
            state.shape_proposals,
            prior.id,
            "superseded",
          ),
          proposal,
        ],
        proposed_shape: proposal,
      };
      return {
        events: [
          {
            event_type: "shape_proposal_corrected",
            actor: "levi",
            perspective: "ul_levi_report",
            payload: { proposal_id: prior.id, correction },
          },
          {
            event_type: "shape_proposal_created",
            actor: "runtime",
            perspective: "proposal",
            payload: { proposal, revises: prior.id },
          },
        ],
        next,
        interaction: shapeInteraction(next),
        available_actions: [
          "accept_shape_proposal",
          "correct_shape_proposal",
          "reject_shape_proposal",
          "request_shape_proposal",
        ],
        correction_action: "correct_shape_proposal",
      };
    }

    case "reject_shape_proposal": {
      requirePhase(state, ["shape"]);
      if (!state.proposed_shape) throw new Error("no_shape_proposal");
      const proposal = {
        ...state.proposed_shape,
        proposal_status: "rejected" as const,
      };
      return {
        events: [{
          event_type: "shape_proposal_rejected",
          actor: "levi",
          perspective: "decision",
          payload: {
            proposal_id: proposal.id,
            reason: text(request.input.reason),
          },
        }],
        next: {
          ...state,
          current_step: "shape",
          shape_proposals: withProposalStatus(
            state.shape_proposals,
            proposal.id,
            "rejected",
          ),
          proposed_shape: null,
        },
        interaction: {
          kind: "question",
          prompt:
            "The proposal was rejected and remains in history. What must the next proposal respect?",
          input_mode: "dictation_or_text",
          choices: [],
        },
        available_actions: [
          "request_shape_proposal",
          "recover_authoritative_state",
        ],
        correction_action: "request_shape_proposal",
      };
    }

    case "accept_shape_proposal": {
      requirePhase(state, ["shape"]);
      if (!state.proposed_shape) throw new Error("no_shape_proposal");
      const accepted = {
        ...state.proposed_shape,
        proposal_status: "accepted" as const,
      };
      const installed = toInstalledShape(accepted, request);
      const next: MainLoopState = {
        ...state,
        current_step: "shape_installation",
        shape_proposals: withProposalStatus(
          state.shape_proposals,
          accepted.id,
          "accepted",
        ),
        proposed_shape: null,
        installed_shape: installed,
      };
      return {
        events: [{
          event_type: "shape_proposal_accepted",
          actor: "levi",
          perspective: "decision",
          payload: {
            proposal_id: accepted.id,
            declared_starting_conditions:
              installed.declared_starting_conditions,
            small_move_exception: installed.small_move_exception,
          },
        }, {
          event_type: "shape_installation_started",
          actor: "system",
          perspective: "lr_system_evidence",
          payload: {
            installation_requirements: installed.installation_requirements,
          },
        }],
        next,
        interaction: shapeInteraction(next),
        available_actions: [
          "record_installation_action",
          "confirm_shape_installed",
          "recover_authoritative_state",
        ],
        correction_action: "record_installation_action",
      };
    }

    case "record_installation_action": {
      requirePhase(state, ["shape"]);
      if (!state.installed_shape) throw new Error("accepted_shape_required");
      const description = text(request.input.description);
      if (!description) throw new Error("installation_action_required");
      const action = {
        description,
        evidence: text(request.input.evidence) || null,
        completed_at: now(),
      };
      const installed: InstalledShape = {
        ...state.installed_shape,
        installation_actions: [
          ...state.installed_shape.installation_actions,
          action,
        ],
        installation_status: "in_progress",
      };
      const next = { ...state, installed_shape: installed };
      return {
        events: [{
          event_type: "shape_installation_action_recorded",
          actor: "levi",
          perspective: "ur_observed_behavior",
          payload: action,
        }],
        next,
        interaction: shapeInteraction(next),
        available_actions: [
          "record_installation_action",
          "confirm_shape_installed",
          "recover_authoritative_state",
        ],
        correction_action: "record_installation_action",
      };
    }

    case "confirm_shape_installed": {
      requirePhase(state, ["shape"]);
      if (!state.installed_shape) throw new Error("accepted_shape_required");
      const conditionsSatisfied = request.input.conditions_satisfied === true;
      const waiver = text(request.input.waiver);
      if (!conditionsSatisfied && !waiver) {
        throw new Error("installation_confirmation_required");
      }
      if (
        state.installed_shape.installation_requirements.length > 0 &&
        state.installed_shape.installation_actions.length === 0 &&
        !waiver &&
        !state.installed_shape.small_move_exception
      ) {
        throw new Error("installation_actions_required");
      }
      const installed: InstalledShape = {
        ...state.installed_shape,
        installation_status: "installed",
        installed_at: now(),
        installation_waiver: waiver || null,
        transition_event_identifier: request.client_event_id,
      };
      const custody: MoveCustody = {
        move_position: "not_started",
        latest_progress: null,
        latest_interruption: null,
        active_friction: null,
        pause_reason: null,
        last_resumed_at: null,
        completion_claim: null,
        evidence_supplied: [],
        current_disposition: null,
        pending_changed_conditions: null,
      };
      const next: MainLoopState = {
        ...state,
        authoritative_phase: "move",
        current_step: "move_cockpit",
        installed_shape: installed,
        move_custody: custody,
      };
      return {
        events: [
          {
            event_type: "shape_installed",
            actor: "levi",
            perspective: "decision",
            payload: {
              proposal_id: installed.accepted_proposal_id,
              installation_actions: installed.installation_actions,
              waiver: installed.installation_waiver,
              small_move_exception: installed.small_move_exception,
            },
          },
          {
            event_type: "parent_entered_move",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: {
              shape_version: installed.shape_version,
              exit_condition: installed.exit_condition,
            },
          },
        ],
        next,
        interaction: surfaceForState(next).interaction,
        available_actions: surfaceForState(next).available_actions,
        correction_action: "report_changed_conditions",
      };
    }

    case "record_move_progress": {
      requireMove(state);
      const progress = record(request.input.progress);
      if (Object.keys(progress).length === 0) {
        throw new Error("move_progress_required");
      }
      const position = text(request.input.move_position) || "active";
      if (
        ![
          "not_started",
          "starting",
          "active",
          "paused",
          "interrupted",
          "blocked",
          "awaiting_external_condition",
          "completion_claimed",
        ].includes(position)
      ) {
        throw new Error("invalid_move_position");
      }
      let adjustment = state.active_adjustment;
      const events: RuntimeEvent[] = [{
        event_type: "move_progress_recorded",
        actor: "levi",
        perspective: "ul_levi_report",
        payload: { progress, move_position: position },
      }, {
        event_type: "move_position_updated",
        actor: "system",
        perspective: "lr_system_evidence",
        payload: { move_position: position },
      }];
      const nestedResult = text(request.input.nested_result);
      if (adjustment && !adjustment.closed_at && nestedResult) {
        adjustment = {
          ...adjustment,
          nested_phase: "closed",
          result: nestedResult,
          effect_on_parent: text(request.input.effect_on_parent) ||
            "parent_move_restored",
          closed_at: now(),
        };
        events.push(
          {
            event_type: "nested_adjustment_executed",
            actor: "levi",
            perspective: "ur_observed_behavior",
            payload: { adjustment_id: adjustment.id, result: nestedResult },
          },
          {
            event_type: "nested_adjustment_metabolized",
            actor: "runtime",
            perspective: "inference",
            payload: {
              adjustment_id: adjustment.id,
              effect_on_parent: adjustment.effect_on_parent,
            },
          },
          {
            event_type: "parent_move_restored",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: {
              adjustment_id: adjustment.id,
              parent_shape_version: adjustment.parent_shape_version,
            },
          },
        );
      }
      const next: MainLoopState = {
        ...state,
        move_custody: {
          ...state.move_custody!,
          move_position: position as MovePosition,
          latest_progress: progress,
          active_friction: adjustment?.closed_at
            ? null
            : state.move_custody!.active_friction,
        },
        active_adjustment: adjustment,
      };
      return {
        events,
        next,
        interaction: surfaceForState(next).interaction,
        available_actions: surfaceForState(next).available_actions,
        correction_action: "record_move_progress",
      };
    }

    case "request_move_help": {
      requireMove(state);
      if (state.active_adjustment && !state.active_adjustment.closed_at) {
        throw new Error("nested_adjustment_already_active");
      }
      const reportedChange = text(request.input.reported_change);
      const boundary = text(request.input.adjustment_boundary);
      const adjustmentShape = text(request.input.adjustment_shape);
      if (!reportedChange || !boundary || !adjustmentShape) {
        throw new Error("bounded_adjustment_contract_required");
      }
      const adjustment: AdjustmentSubloop = {
        id: crypto.randomUUID(),
        parent_loop_id: state.loop_id,
        parent_phase: "move",
        parent_shape_version: state.installed_shape!.shape_version,
        reported_change: reportedChange,
        adjustment_classification: "bounded_adaptation",
        adjustment_boundary: boundary,
        nested_phase: "move",
        adjustment_shape: adjustmentShape,
        result: null,
        effect_on_parent: null,
        started_at: now(),
        closed_at: null,
      };
      const next: MainLoopState = {
        ...state,
        move_custody: {
          ...state.move_custody!,
          move_position: "blocked",
          active_friction: { reported_change: reportedChange, boundary },
        },
        active_adjustment: adjustment,
      };
      return {
        events: [
          {
            event_type: "move_friction_reported",
            actor: "levi",
            perspective: "ul_levi_report",
            payload: { reported_change: reportedChange },
          },
          {
            event_type: "nested_adjustment_started",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: {
              adjustment_id: adjustment.id,
              parent_shape_version: adjustment.parent_shape_version,
              adjustment_boundary: boundary,
            },
          },
          {
            event_type: "nested_adjustment_shaped",
            actor: "runtime",
            perspective: "proposal",
            payload: {
              adjustment_id: adjustment.id,
              adjustment_shape: adjustmentShape,
            },
          },
        ],
        next,
        interaction: {
          kind: "cockpit",
          prompt:
            `Bounded adjustment: ${adjustmentShape}\nParent Move remains authoritative. Record the nested result when the adjustment has been tried.`,
          input_mode: "dictation_or_text",
          choices: [],
        },
        available_actions: [
          "record_move_progress",
          "recover_authoritative_state",
        ],
        correction_action: "record_move_progress",
      };
    }

    case "record_move_interruption": {
      requireMove(state);
      const interruption = {
        reason: text(request.input.reason),
        position: request.input.position ?? null,
        recorded_at: now(),
      };
      if (!interruption.reason) throw new Error("interruption_reason_required");
      const next: MainLoopState = {
        ...state,
        move_custody: {
          ...state.move_custody!,
          move_position: "interrupted",
          latest_interruption: interruption,
          pause_reason: interruption.reason,
        },
      };
      return {
        events: [{
          event_type: "move_interrupted",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: interruption,
        }, {
          event_type: "move_position_updated",
          actor: "system",
          perspective: "lr_system_evidence",
          payload: { move_position: "interrupted" },
        }],
        next,
        interaction: surfaceForState(next).interaction,
        available_actions: surfaceForState(next).available_actions,
        correction_action: "resume_move",
      };
    }

    case "resume_move": {
      requireMove(state);
      const next: MainLoopState = {
        ...state,
        move_custody: {
          ...state.move_custody!,
          move_position: "active",
          pause_reason: null,
          last_resumed_at: now(),
        },
      };
      return {
        events: [{
          event_type: "move_resumed",
          actor: "levi",
          perspective: "decision",
          payload: { resumed_at: next.move_custody!.last_resumed_at },
        }, {
          event_type: "move_position_updated",
          actor: "system",
          perspective: "lr_system_evidence",
          payload: { move_position: "active" },
        }],
        next,
        interaction: surfaceForState(next).interaction,
        available_actions: surfaceForState(next).available_actions,
        correction_action: "report_changed_conditions",
      };
    }

    case "report_changed_conditions": {
      requireMove(state);
      const report = record(request.input);
      if (Object.keys(report).length === 0) {
        throw new Error("changed_conditions_required");
      }
      const next: MainLoopState = {
        ...state,
        move_custody: {
          ...state.move_custody!,
          pending_changed_conditions: report,
        },
      };
      return {
        events: [{
          event_type: "move_friction_reported",
          actor: "levi",
          perspective: "ul_levi_report",
          payload: report,
        }],
        next,
        interaction: {
          kind: "choice",
          prompt:
            "Do the target, exit condition, main reason, and governing orientation remain valid—and can the change stay inside the accepted permissions?",
          input_mode: "choice",
          choices: ["Bounded adaptation", "Material invalidation"],
        },
        available_actions: ["classify_change", "recover_authoritative_state"],
        correction_action: "classify_change",
      };
    }

    case "classify_change": {
      requireMove(state);
      if (!state.move_custody!.pending_changed_conditions) {
        throw new Error("changed_conditions_report_required");
      }
      const classification = text(request.input.classification);
      if (classification === "bounded_adaptation") {
        const boundary = text(request.input.adjustment_boundary);
        const adjustmentShape = text(request.input.adjustment_shape);
        if (!boundary || !adjustmentShape) {
          throw new Error("bounded_adjustment_contract_required");
        }
        const adjustment: AdjustmentSubloop = {
          id: crypto.randomUUID(),
          parent_loop_id: state.loop_id,
          parent_phase: "move",
          parent_shape_version: state.installed_shape!.shape_version,
          reported_change: JSON.stringify(
            state.move_custody!.pending_changed_conditions,
          ),
          adjustment_classification: "bounded_adaptation",
          adjustment_boundary: boundary,
          nested_phase: "move",
          adjustment_shape: adjustmentShape,
          result: null,
          effect_on_parent: null,
          started_at: now(),
          closed_at: null,
        };
        const next: MainLoopState = {
          ...state,
          move_custody: {
            ...state.move_custody!,
            pending_changed_conditions: null,
            active_friction: {
              report: state.move_custody!.pending_changed_conditions,
              boundary,
            },
          },
          active_adjustment: adjustment,
        };
        return {
          events: [
            {
              event_type: "nested_adjustment_started",
              actor: "system",
              perspective: "lr_system_evidence",
              payload: {
                adjustment_id: adjustment.id,
                parent_shape_version: adjustment.parent_shape_version,
              },
            },
            {
              event_type: "nested_adjustment_shaped",
              actor: "runtime",
              perspective: "proposal",
              payload: {
                adjustment_id: adjustment.id,
                adjustment_boundary: boundary,
                adjustment_shape: adjustmentShape,
              },
            },
          ],
          next,
          interaction: {
            kind: "cockpit",
            prompt:
              `Bounded adjustment: ${adjustmentShape}\nThe parent remains in Move.`,
            input_mode: "dictation_or_text",
            choices: [],
          },
          available_actions: [
            "record_move_progress",
            "recover_authoritative_state",
          ],
          correction_action: "record_move_progress",
        };
      }
      if (classification !== "material_invalidation") {
        throw new Error("invalid_change_classification");
      }
      const metabolize = beginMetabolize(state, "invalidated");
      const next: MainLoopState = {
        ...state,
        authoritative_phase: "metabolize",
        current_step: "metabolize",
        move_custody: {
          ...state.move_custody!,
          current_disposition: "invalidated",
          pending_changed_conditions: null,
        },
        metabolize_state: metabolize,
      };
      return {
        events: [
          {
            event_type: "material_invalidation_reported",
            actor: "levi",
            perspective: "decision",
            payload: {
              report: state.move_custody!.pending_changed_conditions,
              basis: text(request.input.basis),
            },
          },
          {
            event_type: "parent_entered_metabolize",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: { move_disposition: "invalidated" },
          },
        ],
        next,
        interaction: metabolizeInteraction(next),
        available_actions: [
          "submit_metabolize_input",
          "confirm_residue",
          "close_loop",
        ],
        correction_action: "submit_metabolize_input",
      };
    }

    case "claim_completion": {
      requireMove(state);
      const statement = text(request.input.claim_statement);
      const result = text(request.input.claimed_result);
      if (!statement || !result) throw new Error("completion_claim_required");
      const claim = {
        claimant: "levi" as const,
        claimed_at: now(),
        statement,
        claimed_result: result,
        evidence_supplied: Array.isArray(request.input.evidence)
          ? request.input.evidence.map(record)
          : [],
        qualification: text(request.input.qualification) || null,
      };
      const custody: MoveCustody = {
        ...state.move_custody!,
        move_position: "completion_claimed",
        completion_claim: claim,
        evidence_supplied: [
          ...state.move_custody!.evidence_supplied,
          ...claim.evidence_supplied,
        ],
        current_disposition: "completion_claimed",
      };
      const metabolize = {
        ...beginMetabolize({ ...state, move_custody: custody }, "completed"),
        completion_claim_snapshot: claim,
      };
      const next: MainLoopState = {
        ...state,
        authoritative_phase: "metabolize",
        current_step: "completion_verification",
        move_custody: custody,
        metabolize_state: metabolize,
      };
      return {
        events: [
          {
            event_type: "move_completion_claimed",
            actor: "levi",
            perspective: "ul_levi_report",
            payload: claim,
          },
          {
            event_type: "parent_entered_metabolize",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: {
              move_disposition: "completed",
              completion_claim_is_verification: false,
            },
          },
        ],
        next,
        interaction: metabolizeInteraction(next),
        available_actions: [
          "submit_completion_evidence",
          "submit_metabolize_input",
          "confirm_residue",
        ],
        correction_action: "submit_completion_evidence",
      };
    }

    case "submit_completion_evidence": {
      requirePhase(state, ["metabolize"]);
      if (!state.move_custody?.completion_claim) {
        throw new Error("completion_claim_required");
      }
      const evidence = record(request.input.evidence);
      if (Object.keys(evidence).length === 0) {
        throw new Error("completion_evidence_required");
      }
      const next: MainLoopState = {
        ...state,
        move_custody: {
          ...state.move_custody,
          evidence_supplied: [
            ...state.move_custody.evidence_supplied,
            evidence,
          ],
        },
      };
      return {
        events: [{
          event_type: "completion_evidence_recorded",
          actor: "levi",
          perspective: "ur_observed_behavior",
          payload: evidence,
        }],
        next,
        interaction: metabolizeInteraction(next),
        available_actions: [
          "submit_completion_evidence",
          "submit_metabolize_input",
          "confirm_residue",
        ],
        correction_action: "submit_completion_evidence",
      };
    }

    case "release_move":
    case "abandon_move": {
      requireMove(state);
      const disposition = request.action === "release_move"
        ? "released"
        : "abandoned";
      const eventType = request.action === "release_move"
        ? "move_released"
        : "move_abandoned";
      const metabolize = beginMetabolize(state, disposition);
      const next: MainLoopState = {
        ...state,
        authoritative_phase: "metabolize",
        current_step: "metabolize",
        move_custody: {
          ...state.move_custody!,
          current_disposition: disposition,
        },
        metabolize_state: metabolize,
      };
      return {
        events: [{
          event_type: eventType,
          actor: "levi",
          perspective: "decision",
          payload: { reason: text(request.input.reason) },
        }, {
          event_type: "parent_entered_metabolize",
          actor: "system",
          perspective: "lr_system_evidence",
          payload: { move_disposition: disposition },
        }],
        next,
        interaction: metabolizeInteraction(next),
        available_actions: [
          "submit_metabolize_input",
          "confirm_residue",
          "close_loop",
        ],
        correction_action: "submit_metabolize_input",
      };
    }

    case "submit_metabolize_input": {
      requirePhase(state, ["metabolize"]);
      if (!state.metabolize_state) throw new Error("metabolize_state_required");
      const verification = text(
        request.input.verification_result,
      ) as VerificationResult;
      if (
        state.move_custody?.completion_claim &&
        !verificationResults.includes(verification)
      ) {
        throw new Error("verification_result_required");
      }
      const assessment = record(request.input.verification_assessment);
      const nextMetabolize: MetabolizeState = {
        ...state.metabolize_state,
        verification_result: verification || null,
        verification_assessment: Object.keys(assessment).length
          ? assessment
          : null,
        credited_result: text(request.input.credited_result) || null,
        consequences: stringArray(request.input.consequences),
        released_material: stringArray(request.input.released_material),
        lessons: stringArray(request.input.lessons),
        closure_basis: text(request.input.closure_basis) || null,
      };
      const events: RuntimeEvent[] = [{
        event_type: "metabolize_input_recorded",
        actor: "levi",
        perspective: "ul_levi_report",
        payload: {
          credited_result: nextMetabolize.credited_result,
          consequences: nextMetabolize.consequences,
          lessons: nextMetabolize.lessons,
          closure_basis: nextMetabolize.closure_basis,
        },
      }];
      if (state.move_custody?.completion_claim) {
        const eventType = verification === "verified"
          ? "completion_verified"
          : verification === "partially_verified"
          ? "completion_partially_verified"
          : verification === "cannot_verify"
          ? "completion_unverifiable"
          : "completion_not_verified";
        events.push({
          event_type: eventType,
          actor: "runtime",
          perspective: "falsifier_evidence",
          payload: {
            exit_condition: state.metabolize_state.exit_condition_snapshot,
            verification_result: verification,
            assessment,
            evidence_considered: state.move_custody.evidence_supplied,
          },
        });
      }
      const next = { ...state, metabolize_state: nextMetabolize };
      return {
        events,
        next,
        interaction: metabolizeInteraction(next),
        available_actions: [
          "submit_completion_evidence",
          "submit_metabolize_input",
          "confirm_residue",
        ],
        correction_action: "submit_metabolize_input",
      };
    }

    case "confirm_residue": {
      requirePhase(state, ["metabolize"]);
      if (!state.metabolize_state) throw new Error("metabolize_state_required");
      const residue = record(request.input.residue);
      if (Object.keys(residue).length === 0) {
        throw new Error("conditioned_residue_required");
      }
      const metabolize: MetabolizeState = {
        ...state.metabolize_state,
        residue,
        residue_confirmed: true,
      };
      const next = {
        ...state,
        current_step: "metabolize_disposition",
        metabolize_state: metabolize,
      };
      return {
        events: [{
          event_type: "metabolize_residue_recorded",
          actor: "levi",
          perspective: "decision",
          payload: { residue },
        }],
        next,
        interaction: metabolizeInteraction(next),
        available_actions: ["close_loop", "submit_metabolize_input"],
        correction_action: "submit_metabolize_input",
      };
    }

    case "close_loop": {
      requirePhase(state, ["metabolize"]);
      if (!state.metabolize_state?.residue_confirmed) {
        throw new Error("conditioned_residue_required");
      }
      const completed = state.metabolize_state.move_disposition === "completed";
      const next: MainLoopState = {
        ...state,
        loop_status: completed ? "closed" : "disposed",
        current_step: completed ? "closed" : "disposed",
      };
      return {
        events: [{
          event_type: completed ? "loop_closed" : "loop_disposed",
          actor: "levi",
          perspective: "decision",
          payload: {
            move_disposition: state.metabolize_state.move_disposition,
            closure_basis: state.metabolize_state.closure_basis,
            residue: state.metabolize_state.residue,
          },
        }],
        next,
        interaction: {
          kind: "receipt",
          prompt:
            "The loop is closed or disposed. Its conditioned residue is available to a genuinely new Sense; no next Move has been selected.",
          input_mode: "none",
          choices: [],
        },
        available_actions: ["open_current_surface"],
        correction_action: null,
        close_loop: true,
      };
    }

    case "recover_authoritative_state": {
      const decision = text(request.input.decision);
      if (decision === "mark_unknown") {
        return {
          events: [{
            event_type: "authoritative_state_uncertain",
            actor: "levi",
            perspective: "defect",
            payload: {
              prior_phase: state.authoritative_phase,
              reason: text(request.input.reason),
            },
          }],
          next: {
            ...state,
            loop_status: "unknown",
            authoritative_phase: "unknown",
            current_step: "recovery",
          },
          ...surfaceForState({
            ...state,
            loop_status: "unknown",
            authoritative_phase: "unknown",
            current_step: "recovery",
          }),
        };
      }
      requirePhase(state, ["unknown"]);
      if (decision === "resume") {
        const recovered = text(
          request.input.recovered_phase,
        ) as AuthoritativePhase;
        if (!["sense", "shape", "move", "metabolize"].includes(recovered)) {
          throw new Error("recovered_phase_required");
        }
        const next: MainLoopState = {
          ...state,
          loop_status: "active",
          authoritative_phase: recovered,
          current_step: `${recovered}_recovered`,
        };
        return {
          events: [{
            event_type: "authoritative_state_recovered",
            actor: "levi",
            perspective: "decision",
            payload: {
              recovered_phase: recovered,
              basis: text(request.input.basis),
            },
          }],
          next,
          ...surfaceForState(next),
        };
      }
      if (decision === "dispose") {
        const metabolize = beginMetabolize(
          state,
          "authoritative_state_unknown",
        );
        const next: MainLoopState = {
          ...state,
          loop_status: "active",
          authoritative_phase: "metabolize",
          current_step: "metabolize",
          metabolize_state: metabolize,
        };
        return {
          events: [{
            event_type: "authoritative_state_recovered",
            actor: "levi",
            perspective: "decision",
            payload: { disposition: "authoritative_state_unknown" },
          }, {
            event_type: "parent_entered_metabolize",
            actor: "system",
            perspective: "lr_system_evidence",
            payload: { move_disposition: "authoritative_state_unknown" },
          }],
          next,
          ...surfaceForState(next),
        };
      }
      throw new Error("recovery_decision_required");
    }
  }
}

function renderShape(proposal: ShapeProposal): string {
  const shape = proposal.proposal_content;
  return [
    `Proposal v${proposal.proposal_version} — non-authoritative`,
    `Move target: ${shape.move_target}`,
    `Decision: ${shape.decision}`,
    `Why: ${shape.immediate_why}`,
    `Orientation: ${shape.orientation}`,
    `Exit condition: ${shape.exit_condition}`,
    `Degrees of freedom: ${shape.degrees_of_freedom.join("; ") || "None"}`,
    `Quick-check boundary: ${
      shape.quick_check_adjustments.join("; ") || "None"
    }`,
    `Help required when: ${
      shape.help_required_conditions.join("; ") || "None"
    }`,
    `Invalidated when: ${shape.invalidation_conditions.join("; ") || "None"}`,
    `Expected evidence: ${shape.completion_evidence.join("; ") || "None"}`,
    `Installation requirements: ${
      shape.installation_requirements.join("; ") || "None"
    }`,
    `First physical action: ${shape.first_physical_action}`,
    "",
    "Accepting this proposal does not by itself enter Move. Installation must still be confirmed.",
  ].join("\n");
}

function renderMoveCockpit(state: MainLoopState): string {
  const shape = state.installed_shape;
  const custody = state.move_custody;
  if (!shape || !custody) throw new Error("move_custody_incomplete");
  return [
    `Current Move: ${shape.move_target}`,
    `Position: ${custody.move_position}`,
    `Installed Shape decision: ${shape.decision}`,
    `Why this Move exists: ${shape.immediate_why}`,
    `How to proceed: ${shape.orientation}`,
    `What may vary: ${shape.degrees_of_freedom.join("; ") || "None"}`,
    `Quick check required for: ${
      shape.quick_check_adjustments.join("; ") || "None"
    }`,
    `Help required when: ${
      shape.help_required_conditions.join("; ") || "None"
    }`,
    `Invalidated when: ${shape.invalidation_conditions.join("; ") || "None"}`,
    `Observable exit condition: ${shape.exit_condition}`,
    `Expected evidence: ${shape.completion_evidence.join("; ") || "None"}`,
    `Latest known position: ${
      custody.latest_progress
        ? JSON.stringify(custody.latest_progress)
        : custody.move_position
    }`,
    state.active_adjustment && !state.active_adjustment.closed_at
      ? `Active bounded adjustment: ${state.active_adjustment.adjustment_shape}`
      : "",
  ].filter(Boolean).join("\n");
}
