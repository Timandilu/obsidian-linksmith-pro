export function countTriggerCharacters(query: string): number {
	return (query.match(/[\p{L}\p{N}]/gu) || []).length;
}

export function meetsMinimumTriggerCharacters(
	query: string,
	minimum: number,
): boolean {
	return countTriggerCharacters(query) >= Math.max(1, Math.floor(minimum));
}
