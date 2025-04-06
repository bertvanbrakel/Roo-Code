# Roo Code NATS Integration

This document describes the NATS integration features in Roo Code, allowing for remote monitoring and control.

## NATS Subject Design Rationale

Roo Code utilizes a hierarchical NATS subject structure for publishing events, following the pattern `roo.{instanceId}.{type}.{subtype}` (e.g., `roo.machine1-projA.events.llm_request`). This granular approach was chosen over a single event subject (e.g., `roo.{instanceId}.events` with a type field in the payload) for the following reasons:

*   **Efficient Filtering:** NATS clients can subscribe *only* to the specific event types they are interested in (e.g., `roo.*.events.status_update`). The NATS server handles this filtering efficiently, significantly reducing network traffic and processing load for subscribers that only need a subset of the data, compared to receiving all events and filtering client-side.
*   **Clear Intent:** The subject name itself explicitly declares the type of event being published, making monitoring and debugging easier.
*   **NATS Best Practice:** Using hierarchical subjects for categorization and filtering is the standard, recommended pattern in NATS development.
*   **Granular Authorization:** NATS server administrators can configure more specific publish/subscribe permissions based on the detailed subject hierarchy (e.g., allowing a monitoring service read-only access to `events.*` but denying access to `control.*`).
*   **Scalability & Flexibility:** The structure easily accommodates new event types in the future without requiring changes to existing subscribers uninterested in the new types. It also supports flexible wildcard subscriptions (e.g., `roo.{instanceId}.events.>` to get all events, or `roo.{instanceId}.events.tool.*` to get all tool-related events).

While clients needing *all* events must use a wildcard subscription (`>`), this is a standard NATS feature. The benefits of efficient server-side filtering, adherence to best practices, and granular control outweigh the simplicity of managing a single subject name.

*(This document will be expanded with configuration details, full subject lists, and command definitions as the feature is implemented.)*