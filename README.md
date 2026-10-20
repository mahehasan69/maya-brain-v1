# Maya Brain v1

Maya is an AI companion project designed to develop natural conversation, long-term memory, online research, and controlled model improvement.

## Core systems

### 1. Memory Engine
- Store conversation history with user permission.
- Remember relevant preferences, events, and relationship milestones.
- Retrieve relevant memories when responding.
- Support memory review, correction, export, and deletion.
- Keep each user's data isolated and protected.

### 2. Research Engine
- Discover permitted books, articles, and research.
- Extract useful knowledge about psychology, communication, relationships, and emotional intelligence.
- Preserve source information and publication details.
- Separate verified information from uncertain claims.
- Respect copyright, privacy, and source access restrictions.

### 3. Learning Engine
- Collect explicit feedback and approved training examples.
- Identify recurring weaknesses in Maya's responses.
- Propose improvements using curated data.
- Evaluate candidate model versions before deployment.
- Keep the current model available for rollback.

## Learning cycle

1. Research and collect approved knowledge.
2. Retrieve relevant knowledge and memories during conversations.
3. Gather permitted feedback.
4. Curate and review training examples.
5. Train or fine-tune a candidate model.
6. Evaluate quality, safety, and conversational consistency.
7. Deploy only if the candidate passes evaluation.

## Development principles

- Privacy and consent by design.
- No training on private conversations without appropriate permission.
- No automatic deployment of untested model updates.
- Protect credentials and API keys.
- Keep the existing Maya Telegram bot separate until integration testing.
- Prefer free tools and services where practical.

## Initial development order

1. Project structure and technical documentation.
2. Memory design and data protection.
3. Research and knowledge retrieval.
4. Evaluation dataset and feedback workflow.
5. Model selection and fine-tuning experiments.
6. Inference service and integration testing.

## Status

Project initialized. Implementation and testing are pending.
