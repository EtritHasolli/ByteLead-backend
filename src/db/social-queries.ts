import { getSupabaseAdmin } from "../lib/supabase.js";

export async function sendFriendRequest(senderId: string, receiverEmail: string) {
  const supabase = getSupabaseAdmin();
  const { data: receiver, error: receiverError } = await supabase.from("users").select("id").eq("email", receiverEmail).single();
  if (receiverError || !receiver) throw new Error("User not found with this email");
  if (receiver.id === senderId) throw new Error("Cannot send friend request to yourself");

  const { data: existing } = await supabase.from("friendships").select("*")
    .or(`and(sender_id.eq.${senderId},receiver_id.eq.${receiver.id}),and(sender_id.eq.${receiver.id},receiver_id.eq.${senderId})`)
    .maybeSingle();
  if (existing) throw new Error("Friendship or request already exists");

  const { data: friendship, error } = await supabase.from("friendships").insert({ sender_id: senderId, receiver_id: receiver.id, status: "pending" }).select().single();
  if (error) throw error;

  await supabase.from("notifications").insert({ user_id: receiver.id, type: "friend_request", actor_id: senderId, entity_id: friendship.id });
  return friendship;
}

export async function respondToFriendRequest(friendshipId: string, userId: string, accept: boolean) {
  const supabase = getSupabaseAdmin();
  const { data: friendship, error: fetchError } = await supabase.from("friendships").select("*").eq("id", friendshipId).single();
  if (fetchError || !friendship) throw new Error("Friendship not found");
  if (friendship.receiver_id !== userId) throw new Error("Unauthorized");

  if (!accept) { await supabase.from("friendships").delete().eq("id", friendshipId); return null; }

  const { data: updated, error } = await supabase.from("friendships").update({ status: "accepted" }).eq("id", friendshipId).select().single();
  if (error) throw error;

  await supabase.from("notifications").insert({ user_id: friendship.sender_id, type: "friend_accept", actor_id: userId, entity_id: friendship.id });
  return updated;
}

export async function getFriends(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("friendships").select(`id, status, sender:sender_id(id, email, full_name, avatar_url), receiver:receiver_id(id, email, full_name, avatar_url)`).or(`sender_id.eq.${userId},receiver_id.eq.${userId}`);
  if (error) throw error;
  return data.map((f: any) => {
    const isSender = f.sender.id === userId;
    return { friendshipId: f.id, status: f.status, isSender, friend: isSender ? f.receiver : f.sender };
  });
}

export async function getNotifications(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("notifications").select(`id, type, is_read, created_at, entity_id, actor:actor_id(id, email, full_name, avatar_url)`).eq("user_id", userId).order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function markNotificationsAsRead(userId: string) {
  const supabase = getSupabaseAdmin();
  await supabase.from("notifications").update({ is_read: true }).eq("user_id", userId).eq("is_read", false);
}
export async function clearNotifications(userId: string) {
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.from("notifications").delete().eq("user_id", userId);
  if (error) throw error;
}
export async function sendMessage(senderId: string, receiverId: string, content: string) {
  if (!content?.trim()) throw new Error("Message cannot be empty");
  if (content.trim().length > 2000) throw new Error("Message is too long");

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("messages").insert({ sender_id: senderId, receiver_id: receiverId, content }).select().single();
  if (error) throw error;

  const chatChannel = [senderId, receiverId].sort().join(":");
  await supabase.channel(`chat:${chatChannel}`).send({ type: "broadcast", event: "new_message", payload: data });
  await supabase.from("notifications").insert({ user_id: receiverId, type: "message", actor_id: senderId, entity_id: data.id });
  return data;
}

export async function getMessages(userId: string, friendId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("messages").select("*")
    .or(`and(sender_id.eq.${userId},receiver_id.eq.${friendId}),and(sender_id.eq.${friendId},receiver_id.eq.${userId})`)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data;
}

export async function shareLeadsPackage(senderId: string, receiverId: string, leadIds: string[], message: string | null = null) {
  const supabase = getSupabaseAdmin();
  if (leadIds.length === 0) throw new Error("No leads to share");

  const { data: user } = await supabase.from("users").select("share_credits_remaining, role").eq("id", senderId).single();
  if (!user) throw new Error("User not found");
  if (user.share_credits_remaining <= 0 && user.role !== "admin") throw new Error("No share credits remaining");

  if (user.role !== "admin") {
    await supabase.from("users").update({ share_credits_remaining: user.share_credits_remaining - 1 }).eq("id", senderId);
  }

  const { data: pkg, error: pkgError } = await supabase.from("share_packages").insert({ sender_id: senderId, receiver_id: receiverId, message }).select().single();
  if (pkgError || !pkg) throw new Error("Failed to create share package");

  const { data: leads } = await supabase.from("leads").select("*").in("id", leadIds);
  if (!leads) throw new Error("Could not fetch leads");

  let successCount = 0;
  for (const lead of leads) {
    if (!lead.revealed) continue;
    const { error: insertError } = await supabase.from("leads").insert({
      user_id: receiverId, scrape_job_id: null, share_package_id: pkg.id,
      business_name: lead.business_name, phone: lead.phone, address: lead.address,
      city: lead.city, state: lead.state, rating: lead.rating, review_count: lead.review_count,
      source: lead.source, source_url: lead.source_url, has_website: lead.has_website,
      is_closed: lead.is_closed, revealed: true, tags: [...(lead.tags || []), "shared"],
      description: lead.description, pitch: lead.pitch, dedupe_key: lead.dedupe_key,
    });
    if (!insertError) successCount++;
  }

  if (successCount === 0) {
    await supabase.from("share_packages").delete().eq("id", pkg.id);
    throw new Error("No leads could be shared (friend already has them all).");
  }

  await supabase.from("notifications").insert({ user_id: receiverId, type: "lead_share", actor_id: senderId, entity_id: pkg.id });
  return { success: true, count: successCount, packageId: pkg.id };
}

export async function getReceivedSharePackages(userId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("share_packages")
    .select("*, sender:users!sender_id(*), leads(*)")
    .eq("receiver_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function deleteSharePackage(userId: string, packageId: string) {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.from("share_packages").select("sender_id, receiver_id").eq("id", packageId).maybeSingle();
  if (error) throw error;
  if (!data || (data.sender_id !== userId && data.receiver_id !== userId)) {
    throw new Error("Share package not found or not authorized");
  }
  const { error: delError } = await supabase.from("share_packages").delete().eq("id", packageId);
  if (delError) throw delError;
}
