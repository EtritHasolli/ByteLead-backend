import { Router } from "express";
import { requireAuth } from "../lib/auth.js";
import { sendFriendRequest, respondToFriendRequest, getFriends, sendMessage, getMessages, getNotifications, markNotificationsAsRead, shareLeadsPackage } from "../db/social-queries.js";

export const friendsRouter = Router();

friendsRouter.get("/", requireAuth, async (req, res) => {
  try {
    const friends = await getFriends((req as any).userId);
    res.json(friends);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch friends" });
  }
});

friendsRouter.post("/request", requireAuth, async (req, res) => {
  try {
    const { email } = req.body;
    const result = await sendFriendRequest((req as any).userId, email);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

friendsRouter.post("/respond", requireAuth, async (req, res) => {
  try {
    const { friendshipId, accept } = req.body;
    const result = await respondToFriendRequest(friendshipId, (req as any).userId, accept);
    res.json({ success: true, result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

friendsRouter.post("/message", requireAuth, async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    const msg = await sendMessage((req as any).userId, receiverId, content);
    res.json(msg);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

friendsRouter.get("/messages/:friendId", requireAuth, async (req, res) => {
  try {
    const messages = await getMessages((req as any).userId, req.params.friendId);
    res.json(messages);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

friendsRouter.get("/notifications", requireAuth, async (req, res) => {
  try {
    const notifications = await getNotifications((req as any).userId);
    res.json(notifications);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch notifications" });
  }
});

friendsRouter.post("/notifications/read", requireAuth, async (req, res) => {
  try {
    await markNotificationsAsRead((req as any).userId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to mark read" });
  }
});

friendsRouter.post("/share", requireAuth, async (req, res) => {
  try {
    const { receiverId, leadIds, message } = req.body;
    const result = await shareLeadsPackage((req as any).userId, receiverId, leadIds, message);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});
