"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import type {
  GraceAvatarState,
  GraceChatMessage,
  GraceFlowDefinitionLite,
  GraceUndoToastState,
} from "./types";

export interface GraceActiveFlow {
  flow: GraceFlowDefinitionLite;
  conversation_id: string;
  slot_values: Record<string, unknown>;
  client_slot_updated_at: Record<string, string>;
  current_slot_index: number;
  high_value_confirmation_cents?: number;
  total_cents: number;
  idempotency_key: string;
}

interface GraceState {
  barOpen: boolean;
  conversationId: string | null;
  avatarState: GraceAvatarState;
  activeFlow: GraceActiveFlow | null;
  undoToast: GraceUndoToastState | null;
  errorBanner: string | null;
  narrationEnabled: boolean;
  lastInputMode: "text" | "voice";
  collapsed: boolean;
  chatMessages: GraceChatMessage[];
}

type Action =
  | { type: "OPEN_BAR" }
  | { type: "CLOSE_BAR" }
  | { type: "SET_AVATAR"; state: GraceAvatarState }
  | { type: "SET_CONVERSATION"; id: string | null }
  | { type: "START_FLOW"; flow: GraceFlowDefinitionLite; conversationId: string; idempotencyKey: string; prefilled: Record<string, unknown> }
  | { type: "SET_SLOT"; slot_id: string; value: unknown; updated_at?: string }
  | { type: "ADVANCE_SLOT" }
  | { type: "BACK_SLOT" }
  | { type: "SET_HIGH_VALUE_CONFIRMATION"; cents: number }
  | { type: "SET_TOTAL_CENTS"; cents: number }
  | { type: "CANCEL_FLOW" }
  | { type: "FLOW_SUCCEEDED"; toast: GraceUndoToastState }
  | { type: "DISMISS_UNDO_TOAST" }
  | { type: "SET_ERROR"; message: string | null }
  | { type: "SET_NARRATION_ENABLED"; enabled: boolean }
  | { type: "SET_LAST_INPUT_MODE"; mode: "text" | "voice" }
  | { type: "TOGGLE_COLLAPSED" }
  | { type: "SET_COLLAPSED"; collapsed: boolean }
  | { type: "CHAT_APPEND"; message: GraceChatMessage }
  | { type: "CHAT_PATCH_LAST"; patch: Partial<GraceChatMessage> }
  | { type: "CHAT_RESET" };

const NARRATION_LS_KEY = "grace:narration_enabled";
const COLLAPSED_LS_KEY = "grace:avatar_collapsed";

function loadBoolean(key: string, fallback = false): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    return window.localStorage.getItem(key) === "1";
  } catch {
    return fallback;
  }
}

function saveBoolean(key: string, value: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // noop
  }
}

const initialState: GraceState = {
  barOpen: false,
  conversationId: null,
  avatarState: "idle",
  activeFlow: null,
  undoToast: null,
  errorBanner: null,
  narrationEnabled: false,
  lastInputMode: "text",
  collapsed: false,
  chatMessages: [],
};

function reducer(state: GraceState, action: Action): GraceState {
  switch (action.type) {
    case "OPEN_BAR":
      return { ...state, barOpen: true };
    case "CLOSE_BAR":
      return { ...state, barOpen: false };
    case "SET_AVATAR":
      return { ...state, avatarState: action.state };
    case "SET_CONVERSATION":
      return { ...state, conversationId: action.id };
    case "START_FLOW":
      return {
        ...state,
        barOpen: false,
        conversationId: action.conversationId,
        avatarState: "flow_active",
        activeFlow: {
          flow: action.flow,
          conversation_id: action.conversationId,
          slot_values: { ...action.prefilled },
          client_slot_updated_at: {},
          current_slot_index: 0,
          total_cents: 0,
          idempotency_key: action.idempotencyKey,
        },
      };
    case "SET_SLOT":
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: {
          ...state.activeFlow,
          slot_values: { ...state.activeFlow.slot_values, [action.slot_id]: action.value },
          client_slot_updated_at: action.updated_at
            ? { ...state.activeFlow.client_slot_updated_at, [action.slot_id]: action.updated_at }
            : state.activeFlow.client_slot_updated_at,
        },
      };
    case "ADVANCE_SLOT":
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: { ...state.activeFlow, current_slot_index: state.activeFlow.current_slot_index + 1 },
      };
    case "BACK_SLOT":
      if (!state.activeFlow) return state;
      return {
        ...state,
        activeFlow: { ...state.activeFlow, current_slot_index: Math.max(0, state.activeFlow.current_slot_index - 1) },
      };
    case "SET_HIGH_VALUE_CONFIRMATION":
      if (!state.activeFlow) return state;
      return { ...state, activeFlow: { ...state.activeFlow, high_value_confirmation_cents: action.cents } };
    case "SET_TOTAL_CENTS":
      if (!state.activeFlow) return state;
      return { ...state, activeFlow: { ...state.activeFlow, total_cents: action.cents } };
    case "CANCEL_FLOW":
      return { ...state, activeFlow: null, avatarState: "idle" };
    case "FLOW_SUCCEEDED":
      return { ...state, activeFlow: null, avatarState: "success", undoToast: action.toast };
    case "DISMISS_UNDO_TOAST":
      return { ...state, undoToast: null, avatarState: "idle" };
    case "SET_ERROR":
      return { ...state, errorBanner: action.message };
    case "SET_NARRATION_ENABLED":
      saveBoolean(NARRATION_LS_KEY, action.enabled);
      return { ...state, narrationEnabled: action.enabled };
    case "SET_LAST_INPUT_MODE":
      return { ...state, lastInputMode: action.mode };
    case "TOGGLE_COLLAPSED": {
      const next = !state.collapsed;
      saveBoolean(COLLAPSED_LS_KEY, next);
      return { ...state, collapsed: next };
    }
    case "SET_COLLAPSED":
      saveBoolean(COLLAPSED_LS_KEY, action.collapsed);
      return { ...state, collapsed: action.collapsed };
    case "CHAT_APPEND":
      return { ...state, chatMessages: [...state.chatMessages, action.message] };
    case "CHAT_PATCH_LAST": {
      if (state.chatMessages.length === 0) return state;
      const next = state.chatMessages.slice();
      const lastIndex = next.length - 1;
      next[lastIndex] = { ...next[lastIndex], ...action.patch };
      return { ...state, chatMessages: next };
    }
    case "CHAT_RESET":
      return { ...state, chatMessages: [], conversationId: null };
    default:
      return state;
  }
}

interface GraceStoreApi {
  state: GraceState;
  openBar: () => void;
  closeBar: () => void;
  setAvatar: (state: GraceAvatarState) => void;
  setConversationId: (id: string | null) => void;
  startFlow: (input: { flow: GraceFlowDefinitionLite; conversationId: string; prefilled?: Record<string, unknown> }) => void;
  setSlot: (slot_id: string, value: unknown, updated_at?: string) => void;
  advanceSlot: () => void;
  backSlot: () => void;
  setHighValueConfirmation: (cents: number) => void;
  setTotalCents: (cents: number) => void;
  cancelFlow: () => void;
  flowSucceeded: (toast: GraceUndoToastState) => void;
  dismissUndoToast: () => void;
  setError: (message: string | null) => void;
  setNarrationEnabled: (enabled: boolean) => void;
  setLastInputMode: (mode: "text" | "voice") => void;
  toggleCollapsed: () => void;
  setCollapsed: (collapsed: boolean) => void;
  chatAppend: (message: GraceChatMessage) => void;
  chatPatchLast: (patch: Partial<GraceChatMessage>) => void;
  chatReset: () => void;
}

const GraceStoreContext = createContext<GraceStoreApi | null>(null);

export function GraceStoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    dispatch({ type: "SET_NARRATION_ENABLED", enabled: loadBoolean(NARRATION_LS_KEY) });
    dispatch({ type: "SET_COLLAPSED", collapsed: loadBoolean(COLLAPSED_LS_KEY) });
  }, []);

  const openBar = useCallback(() => dispatch({ type: "OPEN_BAR" }), []);
  const closeBar = useCallback(() => dispatch({ type: "CLOSE_BAR" }), []);
  const setAvatar = useCallback((avatarState: GraceAvatarState) => dispatch({ type: "SET_AVATAR", state: avatarState }), []);
  const setConversationId = useCallback((id: string | null) => dispatch({ type: "SET_CONVERSATION", id }), []);
  const startFlow = useCallback(
    ({ flow, conversationId, prefilled }: { flow: GraceFlowDefinitionLite; conversationId: string; prefilled?: Record<string, unknown> }) =>
      dispatch({
        type: "START_FLOW",
        flow,
        conversationId,
        idempotencyKey: crypto.randomUUID(),
        prefilled: prefilled ?? {},
      }),
    [],
  );
  const setSlot = useCallback((slot_id: string, value: unknown, updated_at?: string) => {
    dispatch({ type: "SET_SLOT", slot_id, value, updated_at });
  }, []);
  const advanceSlot = useCallback(() => dispatch({ type: "ADVANCE_SLOT" }), []);
  const backSlot = useCallback(() => dispatch({ type: "BACK_SLOT" }), []);
  const setHighValueConfirmation = useCallback((cents: number) => dispatch({ type: "SET_HIGH_VALUE_CONFIRMATION", cents }), []);
  const setTotalCents = useCallback((cents: number) => dispatch({ type: "SET_TOTAL_CENTS", cents }), []);
  const cancelFlow = useCallback(() => dispatch({ type: "CANCEL_FLOW" }), []);
  const flowSucceeded = useCallback((toast: GraceUndoToastState) => dispatch({ type: "FLOW_SUCCEEDED", toast }), []);
  const dismissUndoToast = useCallback(() => dispatch({ type: "DISMISS_UNDO_TOAST" }), []);
  const setError = useCallback((message: string | null) => dispatch({ type: "SET_ERROR", message }), []);
  const setNarrationEnabled = useCallback((enabled: boolean) => dispatch({ type: "SET_NARRATION_ENABLED", enabled }), []);
  const setLastInputMode = useCallback((mode: "text" | "voice") => dispatch({ type: "SET_LAST_INPUT_MODE", mode }), []);
  const toggleCollapsed = useCallback(() => dispatch({ type: "TOGGLE_COLLAPSED" }), []);
  const setCollapsed = useCallback((collapsed: boolean) => dispatch({ type: "SET_COLLAPSED", collapsed }), []);
  const chatAppend = useCallback((message: GraceChatMessage) => dispatch({ type: "CHAT_APPEND", message }), []);
  const chatPatchLast = useCallback((patch: Partial<GraceChatMessage>) => dispatch({ type: "CHAT_PATCH_LAST", patch }), []);
  const chatReset = useCallback(() => dispatch({ type: "CHAT_RESET" }), []);

  const api = useMemo<GraceStoreApi>(
    () => ({
      state,
      openBar,
      closeBar,
      setAvatar,
      setConversationId,
      startFlow,
      setSlot,
      advanceSlot,
      backSlot,
      setHighValueConfirmation,
      setTotalCents,
      cancelFlow,
      flowSucceeded,
      dismissUndoToast,
      setError,
      setNarrationEnabled,
      setLastInputMode,
      toggleCollapsed,
      setCollapsed,
      chatAppend,
      chatPatchLast,
      chatReset,
    }),
    [
      state,
      openBar,
      closeBar,
      setAvatar,
      setConversationId,
      startFlow,
      setSlot,
      advanceSlot,
      backSlot,
      setHighValueConfirmation,
      setTotalCents,
      cancelFlow,
      flowSucceeded,
      dismissUndoToast,
      setError,
      setNarrationEnabled,
      setLastInputMode,
      toggleCollapsed,
      setCollapsed,
      chatAppend,
      chatPatchLast,
      chatReset,
    ],
  );

  return <GraceStoreContext.Provider value={api}>{children}</GraceStoreContext.Provider>;
}

export function useGraceStore(): GraceStoreApi {
  const ctx = useContext(GraceStoreContext);
  if (!ctx) throw new Error("useGraceStore must be used within a GraceStoreProvider");
  return ctx;
}

export function useGraceState<T>(selector: (state: GraceState) => T): T {
  const { state } = useGraceStore();
  return useMemo(() => selector(state), [selector, state]);
}

export function computeGraceFlowTotalCents(slots: Record<string, unknown>): number {
  const lineItems = slots.line_items;
  if (!Array.isArray(lineItems)) return 0;
  let total = 0;
  for (const raw of lineItems) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;
    const qty = Number(item.quantity ?? 1);
    const price = Number(item.unit_price ?? 0);
    if (Number.isFinite(qty) && Number.isFinite(price) && price > 0) {
      total += Math.round(qty * price * 100);
    }
  }
  return total;
}

export function useStableGraceCallback<T extends (...args: never[]) => unknown>(fn: T): T {
  return useCallback(
    (...args: Parameters<T>) => fn(...args),
    [fn],
  ) as T;
}
