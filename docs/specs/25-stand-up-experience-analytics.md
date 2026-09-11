# Stand Up experience and Front Desk analytics - approved implementation contract

Brian approved the September 11 UI review and asked to include a fast management view plus time-series analytics. Extend the deployed integration. Preserve authorization, immutable revisions, safe Google v2 conditional writes and separate Front Office signed transport. No fabricated staff data, source verification, historical coverage, policy thresholds or facility assignments.

## Confirmed business semantics

Meeting Monday 09:15; target08:45; configured America/New_York. Sunday can prepare upcomingMonday drafts, normalentryMonday. Staffing/payroll priorMonday-Sunday. 17.15 overtime =17h15m (1035minutes), not decimalhours. CurrentAR means monthlyrentroll, a snapshot rather than cash receivables or revenueflow. Census/openbeds snapshots must not be summed acrossweeks. Missing staysnull, validzero stays0. Five existingfacilityUUIDs/prefixes unchanged.

## Delivery lanes and common interfaces

Haven worktree /Users/brianlewis/Circle of Life/Haven Stand Up Experience. Front Office worktree /Users/brianlewis/COL-Front-Office-Stand-Up-Analytics. Evidence outsideGit /Users/brianlewis/Circle of Life/Haven Stand Up Experience Evidence.

Backend+bridge owner: migration337_stand_up_experience.sql (main ends at336 and requires consecutive versions; recheck main before merge and renumber only this branch if another337 lands first), SQLtests, Pythonworkbook/worker, canonicaldurationhelpers in src/lib/stand-up/duration.ts and tests. Do NOT edit existing model.ts or frontend files; coordinateexports.
HavenUI owner: src/components/stand-up/**, src/lib/stand-up/model.ts, routepages under /admin/stand-up, API action allowlist only if newactions needed, own UItests. Do NOT modify sharedfacilitystore/shell without explicitcoordination. Use existingstorecontext, guardcrossscopechanging.
FrontOffice owner: StandUp model/views/page/analytics/newreadRPC/migration/tests/styles limitedStandUpscope. Root owns deployments, externalconfig, liveaudit/backfill, documentation, coordination. No newdependencies.

## Duration compatibility

Retain existing 16key values contract including legacy overtime_reported in HH.MM for oldclient/worker/filecompatibility and immutable oldreceipts. Add an explicit canonical integer overtime_minutes projection/column to reports and revisions, preserving rawvalues. 17.15 maps1035. ValidHH.MM requires nonnegativefinite numeric, exact<=2fractiondigits and minutecomponent0..59. Invalidlegacydurations produce a needsreview condition, never0 or a guessed conversion. NewUI hours/minutes inputs convert through shared helpers; canonical calculations and comparisons use minutes. Newwrite validation rejects invalidHH.MM. A missingduration staysnull;0means0h0m. No destructive historyrewrite. RPC responses can add newfields; do not remove oldones.

Current signed rows add optional facility-prefixed overtime_minutes and metadata flags to allow correctlatestdisplay; legacy overtime_reported remains asrawreference. FrontOffice must support oldvalid rows with validatedHH.MM conversion and newminutes with consistencychecks. Invalid durations must not enter totals. Coordinate exactmetadata/metrics names beforepublisher changes.

## Haven reads / status metadata

Keep public.stand_up_command invoker wrapper and existing authorization. Add reporting metadata sufficient for source/import labels, recorded/updated-by, first/last submission and laterdraftchanges. Expected optionalreportfields: overtime_minutes:number|null, overtime_issue:boolean, entry_origin:'imported'|'manual'|'recovery'|'initialized', updated_by:string|null, first_submitted_at:string|null, last_submitted_at:string|null, last_submitted_revision_id:string|null. Only report alreadyauthorizedfacilities; userdisplaynames are limitedtoHaven. No personalnames inFrontOffice feed. Importorigin derivedfromactualbatch/revisionmetadata, not a source-verified claim. workspace adds server_now and actor_role ifuseful. Emptybaseline notstarted;16populateddraft notsubmitted. Laterdraft afterready saysNeedsresubmission. Preserve8:45targetaslateinformation withouteditlock. Submitted remainsseparate fromsourceverification.

Historical corrections remainauthorized/reasoned. Any time-of-meeting view must derivefromimmutable revisions recordedat/before Monday09:15. Olderimportedrecords do NOT retroactively create missingmeeting snapshots.

## Front Office history transport

New dedicated numeric dataset standup_weekly_history, dedicatedkey boundonlythatdataset, no weakerexistingingestcontract. One complete fivefacility/oneweek snapshot perbatch (<1000rows). Additional snapshot_kind integer0=latest,1=lastsubmitted,2=as-recorded-at-meeting ifsupported. Rowweek_of_day remains dateepochdaysMonday. Each batch hasdurablesequence/body/idempotency. Keepcurrentpublishersequence untouched; historyusesseparatestate/key. HistorysourceAsOf is authoritative archive-generation timestamp fromHaven's consistentexport, not fabricatedobservationtime; facility asof and reportingweek remainexplicit. This must be documentedandrendered asarchivegeneration/receivedtime, never proofoldfiguresarecurrent. Existingingest rejects regressingsourceAsOf; neverdisablethatguard. Export consistentarchivegeneration globally so correctingolderweeks doesn'trequire backdatingtransportmetadata.

Haven supplies a service-only audited stand_up_export_history(p_organization_id,p_from_week,p_to_week), bounded<=104weeks percall, returning {archive_as_of,snapshots:[{week_start,kind,reports,facilities}...]}. Reports useexistingaggregatefields +canonicalduration/statusmetadata. Exportonlyrealavailableperiods; blankmissingweeksarenotmanufactured. kind2 usesactualrecorded-revisioncutoff; ifnoneexists showunavailable. Root/backends may narrowkind2 ifclearlydocumented, but do notfakecapturedsnapshots.

FrontOffice new audited read_stand_up_history with boundeddatewindowreturnsvalidated/current-authorized sourcehistory. Group newestreceipt perweek+kind, not everydelivery; paginatedUIwindow4/13/26/52weeks and earlierdatedwindows. Enforce sourceenabled/keyscope/memberrevocation/privatepayloadboundary. No HavencredentialsinFrontOffice. Registernewconfigurationdisabledfirst, testthenactivate. Deployreceiver/readers beforepublishingnewmetrics. Do not manipulateexisting datasets' privacy or sourcekeybindings.

## UX

Haven Allfacilities=managementoverview, nevereditablearbitraryfirstALF. Singleassignedfacility fixed/prominent; multisite explicitvalidatedsharedcontextchoice; noassignment blocked. Header/fetchedreport/draft/request/receipt/submission mustmatchactor+org+facility+week. Dirtyedits guarded againstshellchanges; independentlyguard delayedresponse/error/finally and A-B-A, logout/revocation/multitab. Onefocusedformfivecompactgroups, explicitperiod/unithelp, twofieldovertimehours/minutes, dollarformatting, stickySave/Review/Submitnamedfacilityandmeeting, visibleSaving/Saved/Failed. Debouncedonlineautosave retainsCAS/idempotency/dirtygeneration and doesn'tsilentlymarksSubmitted. Finalreview actionexplicit. Technicalimport/recoverymachinery moved to restricted managementsurface; routines showfriendlykeepHaven/usefile/correctedchoices withmoneydollarsanddurationh/m. Historysecondary. No offlinebrowserstorage promise.

FrontDesk defaultMeetingview: topcoverage/8:45deadline/9:15call; smallheadline totals withcoverage; fivefacilityrowswithstatus,census,beds,monthlyrentroll,overtimeh/m,callouts; selectable/expandabledetailsall16metrics. Easyfacilitydrill-down and metric/rangeanalytics. Comparecurrentvsprior exactweek withmatchedfacilitycohort; ifgapsuseprioravailableonlyexplicitlylabeled. Weightedaveragerent uses pairedrent/census andconsistentcohort. Displaycoverage everychart/total, gaplinesforunknownweeks, nointerpolation/missingzero, no rankingfacilitiesbyunadjustedrawcountsasperformance. No inventedoccupancypercent/capacity, revenuefromweeklyrentrollsum, or AIcausality. AddusefulhistoricalCSVexport withperiod,units,coverage andviewkind. Mobile/keyboardaccessible. Deterministicsummaries stateobservedchangesandmissingreports, notinferredcauses.

## Additional acceptance and open policy

Audit actualadminassignments read-only and reportmissing/multisiteambiguities; do notguessorchangegrants. Validate current2026history contentandstageonlycomparableerrorfreeblocks withoriginalprovenance and auditedreversal. Historicaloverlap/oldschemas remainheld. Remaining metricdefinitions such as censusabsences/openpositioncount/outreachunits require ownerfacts; existinglabelsremainuntilconfirmed and don'tcreatefalsevalidationthresholds.

Prove unit/SQL/browser tests under singlefacility,multifacility,owner,unassigned andrevokedscopes. Preservetruezero/null, durationrollovers andinvalidminutes, month/year/Sundayboundaries, autosavedirty races, no stale crossALFresponses, sourceencodingcompatibility and exporterordering. Use syntheticisolatedrolefixtures for adversarialtesting; never insertinventedoperationalfigures into production. Fullappchecks, nativePostgreSQLreplay (no localDocker), independentsecurity/functionalreviews, requiredsegmentgates, desktop/phonevisualchecks andactualhostedcookie-authenticatedAPIchecks. Onlyactivateaftercompatibledeployment and backup/rollback evidence. Oneownedcommit perboundedlane, preserveallconcurrentwork.
