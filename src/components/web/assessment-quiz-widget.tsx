"use client";

import React, { useState } from "react";
import {
  HelpCircle,
  RotateCcw,
  Calendar
} from "lucide-react";
import { QUIZ_QUESTIONS } from "@/lib/data/quiz-questions";

interface AssessmentQuizWidgetProps {
  onOpenTourModal?: () => void;
}

export function AssessmentQuizWidget({ onOpenTourModal }: AssessmentQuizWidgetProps) {
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState<number>(0);
  const [answers, setAnswers] = useState<number[]>([]);
  const [quizCompleted, setQuizCompleted] = useState<boolean>(false);

  const currentQuestion = QUIZ_QUESTIONS[currentQuestionIndex];

  const handleSelectOption = (points: number) => {
    const updatedAnswers = [...answers, points];
    setAnswers(updatedAnswers);

    if (currentQuestionIndex + 1 < QUIZ_QUESTIONS.length) {
      setCurrentQuestionIndex(currentQuestionIndex + 1);
    } else {
      setQuizCompleted(true);
    }
  };

  const resetQuiz = () => {
    setCurrentQuestionIndex(0);
    setAnswers([]);
    setQuizCompleted(false);
  };

  const totalScore = answers.reduce((acc, curr) => acc + curr, 0);

  let recommendationTier = {
    title: "Gentle Community Respite or Level 1 Assisted Living",
    urgency: "Planning & Prevention",
    description:
      "Your loved one is maintaining baseline independence, but early signs of medication slips or physical fatigue indicate that having a supportive community with home-cooked meals and 24/7 staff nearby will preserve their vitality and prevent a major crisis.",
    badgeColor: "bg-emerald-100 text-emerald-800 border-emerald-300",
  };

  if (totalScore >= 18) {
    recommendationTier = {
      title: "Immediate Assisted Living Placement Recommended",
      urgency: "High Priority for Safety & Caregiver Relief",
      description:
        "The combination of frequent medication slips, fall risks, and severe caregiver exhaustion means living alone at home carries critical safety hazards. Transitioning into Circle of Life will immediately provide 24/7 medication administration, full safety monitoring, and give your family back peaceful nights.",
      badgeColor: "bg-amber-100 text-amber-900 border-amber-300",
    };
  } else if (totalScore >= 8) {
    recommendationTier = {
      title: "Standard Assisted Living (Level 1–2 Support)",
      urgency: "Optimal Window for Transition",
      description:
        "Your loved one would thrive in our standard assisted living suites with daily hands-on support for bathing, meals, and medication management before an unexpected fall or hospitalization occurs.",
      badgeColor: "bg-blue-100 text-blue-900 border-blue-300",
    };
  }

  return (
    <section id="quiz" className="py-20 bg-[#faf7f2]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#3d5a4c]/10 text-[#3d5a4c] text-xs font-bold uppercase tracking-wider mb-2">
            <HelpCircle className="w-3.5 h-3.5" />
            <span>60-Second Family Decision Matrix</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1e2b24] font-serif">
            Is It Time for Assisted Living?
          </h2>
          <p className="text-stone-600 text-sm mt-1">
            Answer 5 confidential clinical questions to receive an objective care evaluation tailored for your family.
          </p>
        </div>

        {/* Main Quiz Box */}
        <div className="bg-white rounded-3xl p-6 sm:p-10 border border-stone-200 shadow-xl">
          {!quizCompleted ? (
            <div className="space-y-6">
              {/* Progress Indicator */}
              <div className="flex items-center justify-between text-xs font-bold text-stone-600 pb-3 border-b border-stone-100">
                <span>
                  Question {currentQuestionIndex + 1} of {QUIZ_QUESTIONS.length}
                </span>
                <span className="text-[#3d5a4c]">
                  {Math.round(((currentQuestionIndex + 1) / QUIZ_QUESTIONS.length) * 100)}% Complete
                </span>
              </div>

              {/* Question Title */}
              <div>
                <h3 className="text-xl sm:text-2xl font-bold text-[#1e2b24] font-serif">
                  {currentQuestion.title}
                </h3>
                <p className="text-xs sm:text-sm text-stone-600 mt-1">{currentQuestion.subtitle}</p>
              </div>

              {/* Options */}
              <div className="grid gap-3 pt-2">
                {currentQuestion.options.map((option, idx) => (
                  <button
                    key={idx}
                    onClick={() => handleSelectOption(option.points)}
                    className="p-4 rounded-2xl text-left border-2 border-stone-200 hover:border-[#c86d51] hover:bg-stone-50 transition-all group flex items-start gap-3"
                  >
                    <span className="w-6 h-6 rounded-full bg-stone-100 text-stone-600 group-hover:bg-[#c86d51] group-hover:text-white flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 transition-colors">
                      {String.fromCharCode(65 + idx)}
                    </span>
                    <span className="text-xs sm:text-sm font-semibold text-stone-800 group-hover:text-[#1e2b24] transition-colors leading-relaxed">
                      {option.text}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Results Screen */
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="flex items-center justify-between pb-4 border-b border-stone-200">
                <span
                  className={`px-3 py-1 rounded-full text-xs font-bold border ${recommendationTier.badgeColor}`}
                >
                  {recommendationTier.urgency}
                </span>
                <button
                  onClick={resetQuiz}
                  className="flex items-center gap-1.5 text-xs text-stone-600 hover:text-stone-900 font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retake Assessment</span>
                </button>
              </div>

              <div className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-[#3d5a4c]">
                  Clinical Readiness Evaluation:
                </div>
                <h3 className="text-2xl sm:text-3xl font-bold text-[#1e2b24] font-serif">
                  {recommendationTier.title}
                </h3>
                <p className="text-sm text-stone-700 leading-relaxed">
                  {recommendationTier.description}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="p-6 rounded-2xl bg-[#faf7f2] border border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
                <div>
                  <div className="font-bold text-sm text-[#1e2b24]">Next Recommended Step:</div>
                  <div className="text-xs text-stone-600 mt-0.5">
                    Schedule a private consultation & complimentary chef lunch with our Administrator.
                  </div>
                </div>

                <button
                  onClick={onOpenTourModal}
                  className="py-3.5 px-4 rounded-xl bg-[#c86d51] hover:bg-[#b55e43] text-white font-bold text-xs shadow-md transition-colors flex items-center justify-center gap-2"
                >
                  <Calendar className="w-4 h-4 text-amber-200" />
                  <span>Book VIP Family Tour & Lunch</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
