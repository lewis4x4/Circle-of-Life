import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { MedicationOrderEditor } from "./MedicationOrderEditor";
import { CarePlanAuthor } from "@/components/care-plans/CarePlanAuthor";
const rpc=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/supabase/client",()=>({createClient:()=>({rpc})}));
vi.mock("@/contexts/haven-auth-context",()=>({useHavenAuth:()=>({appRole:"nurse"})}));
afterEach(()=>{cleanup();rpc.mockReset();});
function pendingReceipt(){let resolve!:(value:{data:string;error:null})=>void;rpc.mockReturnValue(new Promise<{data:string;error:null}>(done=>{resolve=done;}));return async()=>{await act(async()=>{resolve({data:"saved-record",error:null});});};}
it("locks a care-plan draft while its submitted version is being saved",async()=>{
 const finish=pendingReceipt();render(<CarePlanAuthor residentId="resident" initialItems={[]} onSaved={vi.fn()} />);
 fireEvent.click(screen.getByRole("button",{name:"Start care plan"}));
 for(const [label,value] of [["Effective date","2026-09-06"],["Review due","2026-10-06"],["Category","bathing"],["title","Bathing support"],["description","Documented support need"],["Assistance level","supervision"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole("button",{name:"Save for clinical review"}));
 await waitFor(()=>expect(rpc).toHaveBeenCalledOnce());
 expect(screen.getByLabelText("title")).toBeDisabled();
 expect(screen.getByLabelText("Interventions (one per line)")).toBeDisabled();
 await finish();
 expect(screen.getByRole("button",{name:"Start care plan"})).toBeInTheDocument();
});
it("locks medication fields until the order receipt returns",async()=>{
 const finish=pendingReceipt();render(<MedicationOrderEditor residentId="resident" onSaved={vi.fn()} />);
 fireEvent.click(screen.getByRole("button",{name:"Add medication order"}));
 for(const [label,value] of [["medication name","Fixture order"],["strength","1 unit"],["prescriber name","Fixture prescriber"],["order date","2026-09-06"],["start date","2026-09-06"],["instructions","Follow the written order"],["route","oral"],["frequency","daily"],["controlled schedule","non_controlled"],["Order evidence / reason for change","Signed order reference"]])fireEvent.change(screen.getByLabelText(label),{target:{value}});
 fireEvent.click(screen.getByRole("button",{name:"Save authorized order"}));
 await waitFor(()=>expect(rpc).toHaveBeenCalledOnce());
 expect(screen.getByLabelText("strength")).toBeDisabled();
 expect(screen.getByLabelText("end date")).toBeDisabled();
 await finish();
 expect(screen.getByRole("button",{name:"Add medication order"})).toBeInTheDocument();
});
