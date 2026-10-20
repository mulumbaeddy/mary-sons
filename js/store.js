// Who is signed in, and what they are allowed to see.
export const session = { user: null, profile: null };

export const role = () => session.profile?.role || 'staff';
export const isOwner = () => role() === 'owner';
export const isPartner = () => ['owner', 'mother'].includes(role());   // can see profit & manage stock
export const roleLabel = (r = role()) => ({ owner: 'Owner', mother: 'Partner', staff: 'Staff' }[r] || r);
