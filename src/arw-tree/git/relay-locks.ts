/** Shared by sidebar and CLI relay operations on the same SSH session. */
export const gitRelayLocks=new WeakMap<object,Set<string>>()
