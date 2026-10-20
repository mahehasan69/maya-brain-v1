# Maya Memory Engine — Design v1

## Goal

Give Maya reliable, privacy-conscious memory across conversations, including the ability to recall relevant events after long periods of inactivity.

## 1. Memory categories

### Conversation history
- Store user and assistant messages when the user has consented.
- Preserve message order and timestamps.
- Support configurable retention periods.
- Allow users to export or delete their history.

### Long-term memories
Store useful, user-approved information such as:
- Preferred name and communication style.
- Hobbies and interests.
- Important events and milestones.
- Conversation preferences.
- Relevant ongoing plans and previously discussed topics.

Each memory should include:
- A unique memory ID.
- User ID.
- Memory content.
- Category.
- Creation timestamp.
- Source message reference, where available.
- Confidence and review status.
- Optional expiration date.

### Relationship and interaction context
- Recall meaningful shared conversational moments.
- Adapt warmth, humour, and tone to the user's preferences.
- Avoid assuming a romantic relationship unless the user has chosen that interaction style.
- Never invent memories or claim to remember unavailable conversations.

## 2. Memory retrieval

When a new message arrives:
1. Identify the correct user and conversation.
2. Retrieve recent conversation context.
3. Search long-term memories relevant to the message.
4. Retrieve relevant knowledge from the research library.
5. Generate a response using only the context that is actually available.
6. Record the new message according to the user's consent and retention settings.

## 3. User controls

Provide commands or interface controls to:
- Enable or disable memory.
- View saved memories.
- Correct inaccurate memories.
- Delete individual memories.
- Delete all stored personal memories.
- Request conversation-history deletion.
- Review retention and privacy settings.

## 4. Privacy and security

- Use a stable internal user identifier rather than a display name as the database key.
- Keep different users' records strictly isolated.
- Never expose one user's memories to another user.
- Protect credentials and restrict database access.
- Do not store passwords, authentication tokens, or unnecessary sensitive information as memories.
- Do not use private conversations for model training without appropriate consent.
- Apply deletion requests to the relevant stored records and derived indexes.

## 5. Memory quality

- Distinguish user-provided facts from assumptions.
- Record uncertainty when information is ambiguous.
- Prefer explicit user corrections over older conflicting memories.
- Avoid saving every casual message as a long-term memory.
- Review memory usefulness and retrieval accuracy during testing.

## 6. Long-term continuity

When a user returns after months or years:
1. Retrieve only memories that still exist and are permitted for use.
2. Check dates and context.
3. Acknowledge relevant shared history naturally.
4. Ask when a memory is uncertain or outdated.
5. Never fabricate a past interaction.

## 7. Implementation status

This document defines the design. Database schema, storage, retrieval, consent controls, and tests remain to be implemented.
