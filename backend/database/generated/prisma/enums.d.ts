export declare const UserStatus: {
    readonly active: 'active';
    readonly suspended: 'suspended';
    readonly deleted: 'deleted';
};
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];
export declare const OrgKind: {
    readonly personal: 'personal';
    readonly team: 'team';
};
export type OrgKind = (typeof OrgKind)[keyof typeof OrgKind];
export declare const OrgStatus: {
    readonly active: 'active';
    readonly archived: 'archived';
    readonly suspended: 'suspended';
};
export type OrgStatus = (typeof OrgStatus)[keyof typeof OrgStatus];
export declare const MembershipRole: {
    readonly owner: 'owner';
    readonly admin: 'admin';
    readonly member: 'member';
    readonly viewer: 'viewer';
};
export type MembershipRole = (typeof MembershipRole)[keyof typeof MembershipRole];
export declare const InvitationStatus: {
    readonly pending: 'pending';
    readonly accepted: 'accepted';
    readonly expired: 'expired';
    readonly cancelled: 'cancelled';
    readonly revoked: 'revoked';
};
export type InvitationStatus = (typeof InvitationStatus)[keyof typeof InvitationStatus];
export declare const SessionRevokedReason: {
    readonly logout: 'logout';
    readonly password_changed: 'password_changed';
    readonly user_suspended: 'user_suspended';
    readonly admin_revoked: 'admin_revoked';
    readonly refresh_reuse: 'refresh_reuse';
    readonly expired: 'expired';
    readonly device_revoked: 'device_revoked';
};
export type SessionRevokedReason = (typeof SessionRevokedReason)[keyof typeof SessionRevokedReason];
export declare const AuditActorType: {
    readonly user: 'user';
    readonly system: 'system';
    readonly operator: 'operator';
    readonly device: 'device';
    readonly api_key: 'api_key';
};
export type AuditActorType = (typeof AuditActorType)[keyof typeof AuditActorType];
export declare const AuditResult: {
    readonly success: 'success';
    readonly failure: 'failure';
    readonly denied: 'denied';
};
export type AuditResult = (typeof AuditResult)[keyof typeof AuditResult];
//# sourceMappingURL=enums.d.ts.map