# Homewood Lodge: board check and staff check runbook

Haven's roster and Homewood's physical census board do not agree, and the staff
list carries people who have left along with more than one record for the same
administrator. This runbook is how the two are brought back together and how
that is proved.

Every correction in this runbook happens inside Haven, through a flow that
already exists. Nothing here asks anyone to edit the database. There is no bulk
fix and no merge; those were deliberately not built.

The Board Check does not replace the physical fire census board. The board stays
the source of truth for who is in the building. The check is how Haven is made
to agree with it.

## Phases

### Before the walk

- Confirm the deploy carrying migration `407_facility_data_checks.sql` is live,
  and that the migration is applied to the production project and recorded in
  the ledger.
- Sign in as someone who can admit and discharge residents: owner, org admin,
  facility admin or nurse. A caregiver cannot run a board check.
- Select Homewood Lodge as the facility. The check reads whatever facility the
  selector is on, so a wrong selection walks the wrong building.
- Open the facility overview and read the Data health panel. Write down every
  count, and the roster and Stand Up census numbers as they stand now. These are
  the before picture; the check has no other record of them.
- Open the resident roster and choose Board check. Start the check. One walk per
  facility at a time; if someone else has one open, finish or close theirs first.

### The walk

- Walk the building in room order with the census board in hand. Do not work
  from the screen's order alone if it disagrees with the building.
- For each bed, read what Haven shows, look at the board, and tap one of:
  Matches board, Board empty, Board occupied, Different person, Not on board.
- A bed reading `Bed Hold: Hospital` or `Bed Hold: Vacation/Family` is still
  that resident's bed. It is not an empty bed and must not be marked as one.
- Where the board has a resident Haven does not, mark Board occupied and move
  on. Do not type the name anywhere in the check. The name enters Haven through
  the admit flow, from that resident's admission paperwork.
- A bed that appears mid-walk shows up unmarked the next time the list loads and
  has to be marked like any other.

### Fixes

- Work the What Haven needs list. Each item names the one thing Haven is missing
  and links into the flow that supplies it: admit, record discharge, move room,
  set bed hold, or set maintenance or offline.
- An item clears when Haven's data agrees with the board. It cannot be ticked
  off. If an item is still showing after the correction, the correction did not
  take; open the resident record and check.
- Where the board turns out to have been wrong, mark the bed again with what is
  actually true. The newer mark supersedes the older one and both stay in the
  session history.
- When the progress line reads every bed checked and zero fixes open, Close
  check. If Haven refuses, it will say how many beds are unmarked and how many
  fixes are open; those counts are current, the screen may have been a moment
  behind.
- A closed check with zero open items is the proof that Haven's roster matched
  the board at that moment. It is not a claim about any later moment.

### Staff check with Charlene

- From the staff roster, choose Staff check and start one.
- Every person listed gets exactly one answer: Keep, Deactivate, or Duplicate
  of someone already on the list.
- Where two records are the same person, mark the one being retired as a
  duplicate of the one being kept. Haven suggests candidates by email, by one
  login carrying two staff records, and by name. A suggestion is a reason to
  look, not a decision.
- A duplicate is retired the same way anyone else is: Open deactivate runs the
  offboard, which ends employment and revokes the Haven login. Both halves have
  to go through or the item stays open.
- The check lists how many facility grants the duplicate holds. Reassign them in
  the user settings screen to the identity being kept. Nothing is merged and no
  record moves between identities; that is deliberate.
- Close the check when every identity is resolved and no deactivation is still
  pending.

### After

- Reopen Data health. Beds occupied with nobody in them, residents on census
  with no bed, beds with two residents, offboarded staff who can still sign in,
  and possible duplicate identities should all read zero. Anything that does not
  is a real remaining discrepancy, not a display problem.
- Last board check and Last staff check now show dates rather than Never.
- The roster census and the Stand Up census still sit side by side with no
  colour. They count different moments, so compare them on the next Stand Up
  call rather than correcting one to match the other.
- Update Linear COL-361 with the two session close times and the Data health
  counts before and after. Counts and times only. No resident or staff names in
  the issue, in a comment, or in an attachment. Then move COL-361 to Done.

### The other facilities

Repeat in the Haven rollout order: Homewood, Oakridge, Rising Oaks, Grande
Cypress, The Plantation on Summers. Nothing in the check is specific to
Homewood; each facility gets its own sessions and its own closed proof.

## If something looks wrong

- **The bed list is empty.** The facility has no rooms or beds modelled in
  Haven. Stop and raise it; a board check against an empty bed list proves
  nothing.
- **The screen shows a different building.** Check the facility selector before
  anything else. It drives the whole check.
- **An item will not clear after the correction.** Read the resident record. A
  discharge that did not release the bed, or a room move that only changed one
  side, leaves the data still disagreeing and the item correctly still open.
- **The check starts asking for a bulk action, a second admissions screen, or a
  way to tick items off.** Stop and say so. Any of those would turn a closed
  session back into something that proves nothing.
