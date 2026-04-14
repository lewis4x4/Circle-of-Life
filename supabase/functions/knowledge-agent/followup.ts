function extractContextPrefix(question: string): string {
  const match = question.match(/^\[Context:[\s\S]*?\]\s*/i);
  return match?.[0] ?? "";
}

function stripContextPrefix(question: string): string {
  return question.replace(/^\[Context:[\s\S]*?\]\s*/i, "").trim();
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof item.text === "string") {
          return item.text;
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function looksShortAnswer(text: string): boolean {
  return normalizeText(text).split(" ").filter(Boolean).length <= 6;
}

function withContextPrefix(prefix: string, question: string): string {
  return `${prefix}${question}`.trim();
}

function injectFacilityIntoQuestion(question: string, facilityAnswer: string): string {
  const trimmed = question.trim();
  if (/\bhere\??$/i.test(trimmed)) {
    return trimmed.replace(/\bhere\??$/i, `at ${facilityAnswer}`);
  }
  if (/\bthis facility\??$/i.test(trimmed)) {
    return trimmed.replace(/\bthis facility\??$/i, `at ${facilityAnswer}`);
  }
  if (/\bcurrent facility\??$/i.test(trimmed)) {
    return trimmed.replace(/\bcurrent facility\??$/i, `at ${facilityAnswer}`);
  }
  return `${trimmed} at ${facilityAnswer}`;
}

export function rewriteGraceFollowupQuestion(input: {
  question: string;
  conversationHistory: { role: string; content: unknown }[];
}): string {
  const currentQuestion = input.question;
  const currentUserText = stripContextPrefix(currentQuestion);
  if (!looksShortAnswer(currentUserText)) return currentQuestion;

  const history = input.conversationHistory
    .map((entry) => ({
      role: entry.role,
      text: contentToText(entry.content),
    }))
    .filter((entry) => entry.text.trim().length > 0);

  const lastAssistant = [...history].reverse().find((entry) => entry.role !== "user");
  const lastUserBeforeAssistant = lastAssistant
    ? [...history]
        .slice(0, history.lastIndexOf(lastAssistant))
        .reverse()
        .find((entry) => entry.role === "user")
    : [...history].reverse().find((entry) => entry.role === "user");

  if (!lastAssistant?.text || !lastUserBeforeAssistant?.text) return currentQuestion;

  const contextPrefix = extractContextPrefix(currentQuestion) || extractContextPrefix(lastUserBeforeAssistant.text);
  const previousUserQuestion = stripContextPrefix(lastUserBeforeAssistant.text);
  const assistantText = normalizeText(lastAssistant.text);
  const answer = currentUserText.trim();
  const normalizedAnswer = normalizeText(answer);

  if (
    assistantText.includes("do you mean") &&
    assistantText.includes("only or all facilities")
  ) {
    if (normalizedAnswer === "all facilities" || normalizedAnswer === "all") {
      return withContextPrefix(contextPrefix, `${previousUserQuestion} across all facilities`);
    }
    if (normalizedAnswer.length > 0) {
      return withContextPrefix(contextPrefix, injectFacilityIntoQuestion(previousUserQuestion, answer));
    }
  }

  if (
    assistantText.includes("do you want resident count") &&
    assistantText.includes("occupancy") &&
    assistantText.includes("admissions activity")
  ) {
    if (normalizedAnswer.includes("resident count")) {
      return withContextPrefix(contextPrefix, "How many residents do we have?");
    }
    if (normalizedAnswer.includes("occupancy")) {
      return withContextPrefix(contextPrefix, "What is occupancy right now?");
    }
    if (normalizedAnswer.includes("admissions")) {
      return withContextPrefix(contextPrefix, "What is admissions activity right now?");
    }
  }

  if (
    assistantText.includes("do you want resident count") &&
    assistantText.includes("new leads") &&
    assistantText.includes("who needs attention")
  ) {
    if (normalizedAnswer.includes("resident count")) {
      return withContextPrefix(contextPrefix, "How many residents do we have?");
    }
    if (normalizedAnswer.includes("new leads")) {
      return withContextPrefix(contextPrefix, "Any new leads this week?");
    }
    if (normalizedAnswer.includes("who needs attention") || normalizedAnswer.includes("attention")) {
      return withContextPrefix(contextPrefix, "Who needs attention here?");
    }
  }

  if (
    assistantText.includes("do you mean today") &&
    assistantText.includes("past 7 days") &&
    assistantText.includes("past 30 days")
  ) {
    if (
      normalizedAnswer.includes("today") ||
      normalizedAnswer.includes("past 7 days") ||
      normalizedAnswer.includes("past 30 days")
    ) {
      return withContextPrefix(contextPrefix, `${previousUserQuestion} ${answer}`);
    }
  }

  return currentQuestion;
}
