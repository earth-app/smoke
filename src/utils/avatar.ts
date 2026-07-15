export type AvatarInput = File | Blob | ArrayBuffer | string | { icon: string };
export type AvatarBody = FormData | { url: string } | { base64: string } | { icon: string };

// map an avatar input to the POST body the avatar endpoint expects (or throw on a bad string)
export function resolveAvatarBody(avatar: AvatarInput): AvatarBody {
	// { icon } -> iconify avatar
	if (typeof avatar === 'object' && avatar !== null && 'icon' in avatar) {
		return { icon: avatar.icon };
	}

	// file, blob -> multipart form data
	if (avatar instanceof File || avatar instanceof Blob) {
		const form = new FormData();
		form.append('avatar', avatar);
		return form;
	}

	// array buffer -> multipart form data
	if (avatar instanceof ArrayBuffer) {
		const form = new FormData();
		form.append('avatar', new Blob([avatar]));
		return form;
	}

	// string -> url or base64
	if (typeof avatar === 'string') {
		// disallow http urls for security reasons, only allow https or data uris
		if (avatar.startsWith('https://')) return { url: avatar };
		if (avatar.startsWith('data:image/')) return { base64: avatar };
		throw new Error('Invalid avatar string format');
	}

	throw new Error('Invalid avatar string format');
}
