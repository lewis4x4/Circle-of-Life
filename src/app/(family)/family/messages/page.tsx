"use client";

import { MessageSquare, Send, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const conversation = [
  {
    id: "m-001",
    author: "Director of Nursing",
    role: "Care team",
    message: "Good morning. Margaret slept through the night and completed breakfast without issues.",
    time: "9:08 AM",
    side: "left",
  },
  {
    id: "m-002",
    author: "You",
    role: "Family",
    message: "Thank you. Could you confirm if she joined movement group today?",
    time: "9:14 AM",
    side: "right",
  },
  {
    id: "m-003",
    author: "Director of Nursing",
    role: "Care team",
    message: "Yes, she attended for 35 minutes. We uploaded an update in Today Feed.",
    time: "9:21 AM",
    side: "left",
  },
];

export default function FamilyMessagesPage() {
  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Secure Messages</CardTitle>
          <CardDescription>
            Direct communication with facility leadership and care team coordinators.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="inline-flex items-center gap-1 text-sm text-stone-700">
            <ShieldCheck className="h-4 w-4 text-emerald-600" />
            Encrypted and audited communication stream.
          </p>
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Conversation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {conversation.map((item) => (
            <div
              key={item.id}
              className={`flex ${item.side === "right" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${
                  item.side === "right"
                    ? "border-orange-200 bg-orange-50 text-stone-900"
                    : "border-stone-200 bg-stone-50 text-stone-900"
                }`}
              >
                <p className="mb-1 text-xs font-semibold text-stone-600">
                  {item.author} · {item.role}
                </p>
                <p>{item.message}</p>
                <p className="mt-1 text-[11px] text-stone-500">{item.time}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardContent className="p-3">
          <div className="flex items-center gap-2">
            <Input
              value="Type your question for the care team..."
              readOnly
              className="border-stone-300 bg-stone-50 text-stone-600"
            />
            <Button className="h-10 bg-orange-600 text-white hover:bg-orange-500">
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="mt-2 inline-flex items-center gap-1 text-xs text-stone-500">
            <MessageSquare className="h-3.5 w-3.5" />
            Messages are visible to authorized family and designated care leaders.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
