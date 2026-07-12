import type { User } from '~/shared/types/user';

// resolve a user's display name: "<first> <last>" -> "<first>" -> legacy name -> "@username"
export function displayName(
	user: Partial<Pick<User, 'first_name' | 'last_name' | 'name' | 'username'>> | null | undefined
): string {
	if (!user) return '';
	const first = user.first_name?.trim();
	const last = user.last_name?.trim();
	if (first && last) return `${first} ${last}`;
	if (first) return first;
	if (user.name?.trim()) return user.name.trim();
	return user.username ? `@${user.username}` : '';
}
