const state = { selectedFacilityId: "22222222-2222-4222-8222-222222222222" };
export function useFacilityStore<T>(selector: (value: typeof state) => T) {
  return selector(state);
}
