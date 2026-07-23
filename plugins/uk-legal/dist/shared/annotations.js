export const READ_ONLY_OPEN = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: true,
};
export const READ_ONLY_CLOSED = {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
};
/** Build annotations with a human-facing title. */
export function withTitle(base, title) {
    return { ...base, title };
}
