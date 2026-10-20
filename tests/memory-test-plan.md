# Maya Memory Engine — Test Plan v1

## Objective

Verify that Maya's memory engine respects consent, preserves user isolation, and retrieves only valid, approved memories.

## Test 1: Privacy defaults

- [ ] Initialize a new user.
- [ ] Confirm memory is disabled by default.
- [ ] Confirm conversation history is disabled by default.
- [ ] Confirm training consent is disabled by default.
- [ ] Confirm no conversation is stored unless history is enabled.

Expected result: A new user has no active memory or history collection by default.

## Test 2: Conversation ownership

- [ ] Create a conversation for User A.
- [ ] Attempt to save a message to User A's conversation using User B's ID.
- [ ] Verify that the operation fails.
- [ ] Verify that User B cannot read User A's messages.

Expected result: Cross-user access is rejected.

## Test 3: Memory consent

- [ ] Attempt to propose a memory while memory is disabled.
- [ ] Verify that the memory is not stored.
- [ ] Enable memory explicitly.
- [ ] Propose a memory again.

Expected result: Memory collection follows the user's current preference.

## Test 4: Approval workflow

- [ ] Propose a memory.
- [ ] Confirm its status is pending.
- [ ] Attempt to retrieve it before approval.
- [ ] Approve it and retrieve it.
- [ ] Reject another memory and confirm it cannot be retrieved.

Expected result: Only approved memories are available to Maya.

## Test 5: Expiration

- [ ] Create an approved memory with an expiration date in the past.
- [ ] Attempt to retrieve it.

Expected result: Expired memories are not returned.

## Test 6: Invalid inputs

- [ ] Submit an invalid role.
- [ ] Submit an empty message.
- [ ] Submit an unsupported memory category.
- [ ] Submit an invalid confidence value through the database layer.

Expected result: Invalid data is rejected.

## Test 7: Deletion and retention

- [ ] Verify that a user can request deletion of an individual memory.
- [ ] Verify that deleting all personal memories removes their stored records.
- [ ] Verify that conversation-history deletion removes associated messages.
- [ ] Verify that retention rules are enforced.

Expected result: Deletion works across relevant storage locations, including future search indexes.

## Test 8: Training-data separation

- [ ] Confirm training consent is separate from memory consent.
- [ ] Confirm private conversations are not automatically added to training datasets.
- [ ] Confirm only explicitly approved, reviewed examples enter the training pipeline.

Expected result: Personal memory and model-training permissions are independent.

## Release gate

Do not connect the Memory Engine to Maya's production bot until the tests have been implemented, executed, and passed.

Current status: Test plan documented. Automated execution is not yet configured.
