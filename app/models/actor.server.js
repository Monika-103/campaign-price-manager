// Who is making a change.
//
// With online access tokens the session carries the staff member browsing the
// app, so a change can be attributed to a person rather than just to the shop.
// Everything here tolerates the fields being absent: an offline session, or a
// request made outside a browser, should still be able to run a campaign.

export function readActor(session) {
  // The Session object that authenticate.admin returns keeps the staff member
  // under onlineAccessInfo.associated_user. The flat firstName/email fields
  // exist only as columns in the session table, never on the object itself,
  // so reading session.email always came back empty and every change was
  // logged as "The app". The flat fields are kept as a fallback for callers
  // that pass a raw database row.
  const user = session?.onlineAccessInfo?.associated_user ?? {};
  const firstName = user.first_name ?? session?.firstName;
  const lastName = user.last_name ?? session?.lastName;
  const email = user.email ?? session?.email;

  const name = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    actorName: name || null,
    actorEmail: email || null,
  };
}
