"use client";

import React, { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Loader2 } from "lucide-react";

import { loginSchema, type LoginFormData } from "@/lib/validation/auth";
import { createClient } from "@/lib/supabase/client";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Intentionally delay hydration rendering slightly to prevent jarring flashes
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  async function onSubmit(data: LoginFormData) {
    setGlobalError(null);
    try {
      // Execute strict Supabase SSR logic
      const { error } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });

      if (error) {
        setGlobalError(error.message);
        return;
      }

      // Successful routing 
      // Note: A real implementation would verify the app_role (admin vs caregiver) 
      // in the session token and route to /admin or /caregiver accordingly.
      // Defaulting to admin dashboard for phase 1 validation
      router.push("/admin");
      router.refresh();
    } catch {
      setGlobalError("An unexpected system error occurred. Please contact support.");
    }
  }

  if (!mounted) return null;

  return (
    <div className="min-h-screen w-full flex flex-col md:flex-row bg-slate-50 dark:bg-slate-950 font-sans">
      
      {/* Visual Brand Layer - Deep Midnight Slate */}
      <div className="hidden lg:flex flex-1 bg-brand-900 border-r border-slate-200/20 dark:border-slate-800 p-12 flex-col justify-between overflow-hidden relative">
        {/* Subtle geometric background decoration mapping to "Soft Precision" */}
        <div className="absolute top-0 left-0 w-full h-full opacity-[0.03] z-0" style={{ backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)', backgroundSize: '32px 32px' }}></div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-8 h-8 rounded-md bg-white shadow-soft flex items-center justify-center">
              <div className="w-4 h-4 rounded-sm bg-brand-900"></div>
            </div>
            <span className="text-2xl font-serif text-white tracking-tight">Haven</span>
          </div>
          <h1 className="text-4xl text-slate-100 font-display tracking-tight leading-tight max-w-lg mt-12">
            The unified command center for human care.
          </h1>
          <p className="text-brand-300 mt-6 max-w-md text-lg leading-relaxed">
            Welcome back. Sign in to access real-time clinical, financial, and facility operations.
          </p>
        </div>

        <div className="relative z-10">
          <p className="text-brand-400 text-sm">
            &copy; {new Date().getFullYear()} Circle of Life. All rights reserved.
          </p>
        </div>
      </div>

      {/* Authentication Layer */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 relative">
        <div className="w-full max-w-sm space-y-6">
          <div className="flex flex-col space-y-2 text-center lg:text-left mb-8">
            <h2 className="text-3xl font-display font-semibold tracking-tight text-slate-900 dark:text-slate-100">
              Sign In
            </h2>
            <p className="text-slate-500 dark:text-slate-400 text-sm">
              Enter your organizational credentials to continue.
            </p>
          </div>

          <Card className="border-0 shadow-none sm:border sm:border-slate-200 sm:shadow-soft sm:dark:border-slate-800 bg-transparent sm:bg-white sm:dark:bg-slate-900">
            <CardContent className="p-0 sm:p-6 lg:p-8">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-slate-700 dark:text-slate-300 font-medium">Work Email</FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="jane@oakridge.com" 
                            type="email" 
                            disabled={form.formState.isSubmitting}
                            className="bg-slate-50/50 dark:bg-slate-950/50 h-11"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage className="text-severity-3 text-xs" />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center justify-between">
                          <FormLabel className="text-slate-700 dark:text-slate-300 font-medium">Password</FormLabel>
                          {/* Future Phase 2 wiring */}
                          <button type="button" className="text-xs font-medium text-brand-600 hover:text-brand-700 dark:text-brand-400 tap-responsive">
                            Forgot password?
                          </button>
                        </div>
                        <FormControl>
                          <Input 
                            type="password" 
                            placeholder="••••••••" 
                            disabled={form.formState.isSubmitting}
                            className="bg-slate-50/50 dark:bg-slate-950/50 h-11"
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage className="text-severity-3 text-xs" />
                      </FormItem>
                    )}
                  />

                  {globalError && (
                    <div className="p-3 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 rounded-md animate-in fade-in slide-in-from-top-1">
                      <p className="text-sm font-medium text-red-600 dark:text-red-400 text-center">
                        {globalError}
                      </p>
                    </div>
                  )}

                  <Button 
                    type="submit" 
                    className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white tap-responsive font-medium" 
                    disabled={form.formState.isSubmitting}
                  >
                    {form.formState.isSubmitting ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Verifying...
                      </>
                    ) : (
                      "Sign In"
                    )}
                  </Button>
                </form>
              </Form>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
