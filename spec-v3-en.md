> **Status:** Canonical technical reference (v3.0, English edition). It is **amended by [`addendum-v3.1.md`](addendum-v3.1.md)**, which takes precedence wherever the two differ. Converted from `SouqJamia_Developer_Specification_EN_v3.docx`; figures are in `spec-assets/media/`.

A consolidated specification for a responsive Arabic and English campus marketplace. It defines first-release behavior, constraints, failure handling and operations and links them to implementable data, services and acceptance tests.

| **Item**          | **Value**                                                         |
|-------------------|-------------------------------------------------------------------|
| Version           | 3.0                                                               |
| Date              | 16 November 2026                                                  |
| Language          | English with canonical technical identifiers                      |
| Audience          | Development, design, QA and operations                            |
| Coverage          | 80 requirements, 24 use cases, 40 business rules and 24 decisions |
| Detail            | 106 service operations, 42 data entities and 84 acceptance tests  |
| Visuals           | 26 engineering diagrams and 4 selected reference screenshots      |
| Product reference | https://souqjamia.com/                                            |

This edition supersedes the prior merged specification. New-product decisions are separate from reference evidence and launch prerequisites have owners and deadlines. Tests here are an execution and acceptance plan; actual results must be recorded during delivery.

# Contents

| **Chapter**                                                                                            | **Page**                                               |
|--------------------------------------------------------------------------------------------------------|--------------------------------------------------------|
| [01 Product scope and requirement sources](#product-scope-and-requirement-sources)                     | [3](#product-scope-and-requirement-sources)            |
| [02 User experience, screens and design system](#user-experience-screens-and-design-system)            | [5](#user-experience-screens-and-design-system)        |
| [03 Implementation decisions and resolved questions](#implementation-decisions-and-resolved-questions) | [11](#implementation-decisions-and-resolved-questions) |
| [04 Functional requirements and acceptance criteria](#functional-requirements-and-acceptance-criteria) | [14](#functional-requirements-and-acceptance-criteria) |
| [05 Use cases and alternative flows](#use-cases-and-alternative-flows)                                 | [19](#use-cases-and-alternative-flows)                 |
| [06 Business rules and state lifecycles](#business-rules-and-state-lifecycles)                         | [29](#business-rules-and-state-lifecycles)             |
| [07 Architecture integration and concurrency](#architecture-integration-and-concurrency)               | [38](#architecture-integration-and-concurrency)        |
| [08 Data model and field dictionary](#data-model-and-field-dictionary)                                 | [43](#data-model-and-field-dictionary)                 |
| [09 Service contracts, fields and errors](#service-contracts-fields-and-errors)                        | [58](#service-contracts-fields-and-errors)             |
| [10 Security, authorization and payment policies](#security-authorization-and-payment-policies)        | [69](#security-authorization-and-payment-policies)     |
| [11 Quality, performance and capacity targets](#quality-performance-and-capacity-targets)              | [77](#quality-performance-and-capacity-targets)        |
| [12 Retention, backups, operations and response](#retention-backups-operations-and-response)           | [79](#retention-backups-operations-and-response)       |
| [13 Risks, resources, schedule and cost](#risks-resources-schedule-and-cost)                           | [82](#risks-resources-schedule-and-cost)               |
| [14 Verification, acceptance tests and traceability](#verification-acceptance-tests-and-traceability)  | [86](#verification-acceptance-tests-and-traceability)  |
| [15 Launch prerequisites and developer handover](#launch-prerequisites-and-developer-handover)         | [94](#launch-prerequisites-and-developer-handover)     |
| [16 References, catalogs and evidence inventory](#references-catalogs-and-evidence-inventory)          | [96](#references-catalogs-and-evidence-inventory)      |

Select a chapter title to navigate. FR, UC, BR, DEC and TC identifiers are identical across both editions; definitions appear in the glossary.

# 01 Product scope and requirement sources
This specification defines a responsive Arabic and English campus marketplace. Members list items, publish wanted requests, communicate, negotiate and arrange a public meeting. Developers, designers, QA and operators use it as the shared reference for implementing and accepting the first release.

Version 3 covers requirements, detailed behavior, design, data, service contracts, verification and operations. It preserves existing requirement and decision identifiers and adds tests for defects found during review. Both language editions have the same values, identifiers and functions. Any translation discrepancy must be corrected in both before the affected behavior is implemented.

## First release boundary

| **Area**                     | **Included scope**                                                                                                             |
|------------------------------|--------------------------------------------------------------------------------------------------------------------------------|
| Accounts and discovery       | Signup, confirmation, login, recovery, public and private profiles, both languages, search, filtering and favorites.           |
| Listings and wanted requests | Five step publication, images, active/sold/archived management and wanted requests with expiry and limited reopening.          |
| Communication and exchange   | Private messages and images, offers, meetings, read state, live updates, exchange confirmation and eligible reviews.           |
| Safety and operations        | Reporting, blocking, moderation, appeals, notifications and optional support contributions, with security, recovery and audit. |

Item payment, inspection and handover occur between the parties outside the application. R1 includes no shopping cart, shipping, wallet or escrow. A support contribution funds the platform and buys neither ranking nor additional permission.

## Corrections in this revision

| **Area**                | **Correction**                                                                                                                           |
|-------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| Writing and layout      | Repair Arabic spacing and technical text direction, and replace isolated page fragments with connected chapters and navigation.          |
| Interface detail        | Restore home, navigation, footer, listing card, profile and activity detail, with failure and disabled states.                           |
| Offer amount            | Use a consistent minimum of SAR 1, or 100 halalas, across rules, requirements, API and tests.                                            |
| Accounts and meetings   | Specify both-address email confirmation, independent attendance declarations and restrictions preserved during deletion and recovery.    |
| Data and administration | Separate combined entities, complete college, role, domain, media, tracking and dispute definitions, and add missing service operations. |
| Payments and retention  | Separate a failed payment attempt from invoice state and define guest receipt access, review retention and session-secret handling.      |

## Evidence and decision interpretation

| **Code** | **Meaning**                                          | **Limit**                                                                                                     |
|----------|------------------------------------------------------|---------------------------------------------------------------------------------------------------------------|
| L        | Previously recorded public browsing and interaction. | Evidence of that observation, not of server implementation or security.                                       |
| S        | A screenshot supplied by the project owner.          | Shows visible UI, not delivery success or another party’s response.                                           |
| D        | Supplied analyses and reference files.               | May include proposals or unsupported claims; not approved production code.                                    |
| P        | A design decision for the new product.               | Defines this version’s proposed implementation, not the reference site’s behavior.                            |
| DEC / G  | Implementation decision or external prerequisite.    | Technical choices are documented here; operators supply domain, service and entity details before activation. |

The earlier public inspection recorded seven listings, three electronics listings, two after adding a condition and one after adding HONOR search. Sorting, images, public profile and language switching were checked, along with a SAR 15 Stripe redirect and return without card entry. These are observations, not usage metrics or test results for the new product.

The inspection did not create a test account, message, listing, report or review and did not collect money. The original technology is unknown. The original report already contained state and component diagrams; this revision corrects and extends them rather than claiming they were absent.

## Later releases

| **Release** | **Additions**                                                                                                      | **Condition**                                                                                           |
|-------------|--------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| R2          | PWA, Web Push, seven day server drafts, saved search, request-to-listing alerts and a default location preference. | Separate scope, estimate and tests; excluded from R1 acceptance.                                        |
| R3          | AI image-based description suggestions, an approved campus map, paid promotion or an advanced reputation model.    | Product, privacy and cost decisions before design; not automatically adopted from a reference proposal. |

# 02 User experience, screens and design system
![Figure 1 Public pages, member areas and administration. An asterisk indicates that an eligible session is required.](spec-assets/media/image1.png)

Figure 1 Public pages, member areas and administration. An asterisk indicates that an eligible session is required.

The observed item route is /listing/{id}, and the public profile route is /profile/{id}. New member and administrative routes below are implementation proposals, not discovered original endpoints. Preserve resource identity when switching language or opening a shared link.

## Shared navigation
In Arabic, place the logo at the right, followed by search and links to Home, Marketplace, Wanted and Contribute. Visitors see login, signup and add-listing actions. Members see messages, notifications, favorites and an account menu. English reverses layout while identifiers, numbers and URLs remain left-to-right.

The account menu shows name and optional college, then owned listings, requests, profile, favorites, messages, contributions and sign out. On mobile, an accessible collapsible menu contains these destinations. Icons need names and keyboard focus; a sticky header must not cover a target heading or validation message.

The footer contains a marketplace description, how-it-works and safety links, categories, wanted requests and contributions, followed by privacy, terms, community guidance and an actual contact route. G01 and G06 establish operator identity and authorized branding; the university mark and original domain are not assumed to belong to the new project.

## Home page
1\. A clear introductory heading and search, with shortcuts to common categories. Search opens the marketplace with the same query.

2\. Recent listing cards and a full marketplace link. Use four columns where space permits, then two and one without fixed page widths.

3\. Six main category tiles, with Other available in the complete selector. There are seven canonical category values regardless of the home layout.

4\. Recent wanted requests and a link to all requests; an empty section invites publication rather than leaving a blank area.

5\. Explain discovery, contact, agreement, meeting and handover, followed by a public-location inspection reminder.

## Listing card and marketplace
A card contains an approximately 4:3 image, a favorite button that does not open details, an item-condition badge and a negotiable badge only when applicable. Below are the price or Free label, title, public location and a short relative date. Truncated titles retain an accessible full name, and status is never conveyed by color alone.

The marketplace combines query, category, condition, location and order. Store filters in the URL for navigation and sharing; changing one resets pagination. Provide a named reset control and distinct loading, no-results and request-failure states. Retrying must retain the selected filters.

## Listing details and public profile
Details include a back path, gallery and thumbnails, line-preserving description, price, condition, category, meeting location and publication date. A desktop layout may place the gallery beside an action panel; mobile stacks the sections without hiding price or contact controls. Linkify HTTP and HTTPS description URLs only and prevent the opened page from controlling the original window.

A seller cannot contact themselves. Visitors sign in with a preserved local destination. Disable price offers for free, non-negotiable or closed contexts and explain why. Authorized text in an existing conversation may continue after a sale unless blocked or restricted, while new offers and meetings stop.

The public profile shows display name, avatar or initial fallback, optional college, join month, public listings and reviews. Show New seller if there are no eligible visible reviews; otherwise display average and count. A university mailbox badge proves mailbox control only, without implying university endorsement or a transaction guarantee.

## Private profile and activity lists
The private profile includes the email that is not public, account editing and links to listings, requests, favorites, messages and offers. Owned listings have Active, Sold and Archived tabs; wanted requests have Active, Found and Closed tabs. Each tab has an appropriate create action and empty state. A hidden favorite shows Unavailable without disclosing its content.

Signup shows the current terms and privacy versions and links without preselecting acknowledgment. The server records version and time. The reference label My purchase requests means wanted-item requests, not an order or an in-app item payment.

## Listing publication wizard

| **Step** | **Fields and interaction**                                                       | **Continue conditions**                                                      |
|----------|----------------------------------------------------------------------------------|------------------------------------------------------------------------------|
| 1        | Image selection or drop, preview, ordering, removal and primary-image selection. | 1-10 ready JPEG, PNG or WebP images, each at most 5 MiB and 24 megapixels.   |
| 2        | Title counter, category, five single-choice condition cards and description.     | Title 5-100 and description 10-2000; all fields required.                    |
| 3        | SAR price and negotiable toggle; zero means free.                                | 0-50,000 SAR with at most two decimals; free disables negotiation.           |
| 4        | Searchable scrollable approved public facilities; no room address.               | Active location and a public meeting and inspection warning.                 |
| 5        | Full preview, per-step edit links and a clear publish action.                    | Server revalidation and an idempotency key preventing duplicate publication. |

Back navigation preserves text and selections. R1 keeps non-sensitive text within the current tab only, with a clear shared-device choice; it stores no password or raw file locally. Expired images must be uploaded again without erasing text. Clear drafts on logout or account switch and do not promise closed-tab recovery.

## Wanted requests
A wanted card shows title, short description, category, optional location and stated budget, with urgency and publication time. Publication requires title 5-100, description 10-1000 and category; budget and location are optional. Unspecified differs from zero for a free item. A member offering an item starts the conversation and the requester is its buyer.

To confirm exchange and enable reviews, the supplying seller links their own listing to a Deal before request closure. Found status alone does not create a completed exchange or review. The owner view shows expiry and remaining reopening eligibility.

## Messaging and mobile forms
Desktop Arabic places the conversation list beside the chat pane; mobile opens the list and then a separate conversation with a back action. The header shows the other member’s name, college and avatar, followed by a stable context card with its current state. Conversation count differs from unread incoming message count. Desktop Enter sends and Shift+Enter adds a line; mobile retains a visible send button.

A message shows Sending, Saved or Failed with a retry that uses the same identifier. The offer dialog shows reference and proposed amounts; the meeting dialog shows location, date, time and optional note. Dialogs restore focus to their trigger on close and explain invalid or disabled actions.

![Supplied reference screenshots for image upload and item specifications. New-product validation is defined by the specification, not inferred solely from the image.](spec-assets/media/image2.png)

Supplied reference screenshots for image upload and item specifications. New-product validation is defined by the specification, not inferred solely from the image.

![Supplied reference screenshots for image upload and item specifications. New-product validation is defined by the specification, not inferred solely from the image.](spec-assets/media/image3.png)

Supplied reference screenshots for image upload and item specifications. New-product validation is defined by the specification, not inferred solely from the image.

![Supplied offer and meeting dialogs. Original Arabic UI screenshots are retained in both editions as reference evidence.](spec-assets/media/image4.png) ![Supplied offer and meeting dialogs. Original Arabic UI screenshots are retained in both editions as reference evidence.](spec-assets/media/image5.png)

Supplied offer and meeting dialogs. Original Arabic UI screenshots are retained in both editions as reference evidence.

## Administration contributions and policies
Administration includes case queue, evidence, assignment and decision, public-content review, operator account search, appeals, college/category/location catalogs and separately authorized university-domain and role management. There is no general conversation browser; open only case-authorized evidence and audit its access.

Contributions are entirely optional: SAR 10, 15, 30, 50 or a custom SAR 10-500 amount, with 15 selected initially. Explain that support is one-time and does not affect membership. Checkout is hosted by the provider; the return page shows the verified state. Privacy, terms and guidance are public in both languages, with effective date, contact, retention and reporting information.

## Design system and usability
The new product follows the reference’s white or cream surfaces, dark green primary actions, restrained gold badges, fine borders and graduated radii. The following values are proposed design tokens from the supplied material, not verified original CSS. Test each actual text and background combination for contrast before approval.

| **Role**       | **Proposed value**  | **Use**                                                                |
|----------------|---------------------|------------------------------------------------------------------------|
| Primary        | \#0B3B2D            | Primary actions and current wizard step.                               |
| Dark surface   | \#06241B            | Footer and safety banner.                                              |
| Accent         | \#C59B27            | Negotiable and secondary accents with adequate dark text.              |
| Page surface   | \#FAF9F5 / \#FFFFFF | Page, card and form surfaces.                                          |
| Subtle status  | \#EAF2EE / \#F5EFE0 | Badges and guidance with readable text.                                |
| Safety warning | \#FEF9E7 / \#8A4B08 | Public meeting and address privacy warning.                            |
| Danger         | \#DC2626            | Destructive action with text and icon, never color alone.              |
| Borders        | \#E5E7EB / \#CBD5E1 | Dividers and controls; verify input-boundary contrast.                 |
| Text           | \#111827 / \#4B5563 | Primary and secondary text without excessively faint type.             |
| Radii          | 12 / 16 / 24 px     | Controls, cards and containers; fully rounded pills where appropriate. |

Use a readable Arabic font such as Noto Sans Arabic or an approved alternative, paired with compatible Latin type and a consistent heading/body/support scale. Use logical CSS spacing properties and isolate URLs, amounts and identifiers from surrounding direction. Dialogs must fit the available viewport.

Acceptance targets WCAG 2.2 AA: label controls, associate errors, show and restore focus, provide adequate contrast, support 200% zoom and meet target-size requirements, preferably 44 pixels for primary actions. Meaning must not depend on color, hover or motion. Test 360, 768 and 1440 pixels, keyboard access and a representative screen reader. \[R06\]

# 03 Implementation decisions and resolved questions
DEC01-DEC24 turn the earlier U01-U24 questions into explicit values and behavior. They form the proposed design baseline requested for the revised document; they do not establish original-site behavior or availability of operating accounts. The owner and team record the baseline at implementation kickoff and assess any later change across data, contracts, tests and estimate.

### DEC01 Accounts and university affiliation
Allow registration with any valid email. Verify university mailbox ownership only against an operator-approved domain list. The badge grants no extra permissions and makes no claim of current student status.

U-01 \| UC01 UC22 \| FR01 FR58 \| BR02 BR22

### DEC02 Required email confirmation
Create an unconfirmed identity and prohibit market writes until confirmation. Confirmation links last 24 hours; resend cooldown is 60 seconds, subject to RL03 and provider limits.

U-02 \| UC01 UC02 \| FR04 FR57 \| BR01 BR21

### DEC03 Profile and credential changes
Names are 2-50 characters; college is optional. Protect credential changes with recent reauthentication. Confirm both email addresses before replacement. Passwords are 15-64 characters and at most 72 UTF-8 bytes with bcrypt.

U-03 \| UC02 UC20 \| FR03 FR49 FR59 \| BR23 BR24

### DEC04 Text length
Listing titles are 5-100 characters and descriptions 10-2000 after trimming. Preserve user language and line breaks; do not automatically translate member content.

U-04 \| UC06 UC07 \| FR18 \| BR05

### DEC05 Maximum marketplace price
Allow 0-50,000 SAR with at most two decimal places in the interface. The API stores 0-5,000,000 integer halalas and rejects negative, non-finite or over-precise values.

U-05 \| UC06 UC11 \| FR19 FR34 \| BR07 BR08

### DEC06 Free items
Zero is a valid free listing. Disable price offers and negotiation for that listing while keeping conversation, meetings and exchange confirmation available.

U-06 \| UC06 UC11 \| FR19 FR33 \| BR08 BR09

### DEC07 Draft recovery
R1 preserves non-sensitive text only in the current tab. It does not promise recovery after tab closure. Temporary image references are revalidated for 24 hours. A seven day server draft belongs to R2.

U-07 \| UC06 \| FR21 FR60 \| BR25

### DEC08 Image inputs and derivatives
Accept JPEG, PNG and WebP, 1-10 per listing, each at most 5 MiB and 24 megapixels. Generate longest-edge derivatives of 150, 600 and 1200 pixels without upscaling and remove metadata.

U-08 \| UC06 UC10 \| FR17 FR61 \| BR06 BR26

### DEC09 Listing lifecycle
Sold is irreversible. An owner may restore an archived active listing within 90 days. Preserve whether an archive originated as sold; hiding for moderation is a separate restriction. Purging follows RET, not a 90 day shortcut.

U-09 \| UC07 \| FR23 FR24 \| BR27 BR28

### DEC10 Conversation uniqueness
One conversation exists for one context and one buyer-seller pair. Enforce separate listing and wanted uniqueness constraints and exactly one context reference. Derive roles on the server.

U-10 \| UC10 \| FR29 FR62 \| BR29

### DEC11 Closed context behavior
Keep the context snapshot and display its current state. A sold listing or closed request prevents new offers and meetings, but authorized text may continue. Reviews depend on a completed Deal.

U-11 \| UC10 UC17 \| FR28 FR42 \| BR12 BR18

### DEC12 Blocking and unblocking
A block in either direction prevents new communication and new Deals. Keep history readable to eligible participants, allow reporting and permitted cancellation, and allow confirmation of a pre-existing Deal. Unblocking does not revive cancelled records or lift an account restriction.

U-12 \| UC16 UC20 \| FR44 FR63 \| BR16 BR30

### DEC13 Unread state
UUIDv4 is an identifier only. Assign a monotonic message_seq within each conversation and store last_read_seq per member. Count only incoming non-system messages beyond that cursor.

U-13 \| UC10 UC19 \| FR30 FR64 \| BR31

### DEC14 Retries and concurrency
Use client_message_id and idempotency keys for logical retries. Decide offers through atomic state, version and expiry checks. Acceptance is a preliminary agreement, not item reservation.

U-14 \| UC10 UC12 \| FR35 FR41 \| BR13 BR32

### DEC15 Offer and meeting limits
An offer is at least 1 SAR, with one pending offer per conversation and 72 hour expiry. Propose meetings 30 minutes to 30 days ahead. Preserve late cancellations and record each member’s attendance declaration independently.

U-15 \| UC11 UC12 UC13 UC14 \| FR34 FR38 FR39 FR65 \| BR33 BR34

### DEC16 Actual exchange and reviews
Only the listing seller initiates a Deal and selects a buyer from an eligible context. Completion requires independent confirmation by both. Each may submit one non-editable review, integer 1-5 stars and a comment up to 500 characters, within 30 days. Both confirmations must occur within seven days of creation; cancel an uncompleted Deal after that deadline.

U-16 \| UC17 \| FR47 FR66 \| BR18 BR35

### DEC17 Reports and moderation
Provide seven report reasons. Review before action; aim to triage within 48 hours under an assigned operating role. Notify the reporter of progress and the subject only after a relevant action. Permit a 14 day appeal.

U-17 \| UC15 UC21 \| FR45 FR54 FR67 \| BR17 BR36

### DEC18 Wanted request fields
Require a title, description and category; location and budget are optional. Null means no stated budget and zero means a free-item request. Initial expiry is 60 days after creation.

U-18 \| UC08 UC09 \| FR25 FR26 FR27 \| BR37

### DEC19 Reopening a request
Allow one reopening within 30 days of first closure, including found requests, and no later than day 90 from creation. The new expiry is the earlier of reopen time plus 30 days and creation plus 90 days.

U-19 \| UC09 \| FR27 \| BR37

### DEC20 Notification scope
R1 includes in-app notifications and selected email without chat content. Do not notify the subject when a report is merely filed. Retain notifications for 90 days. Web Push requires R2 opt-in.

U-20 \| UC19 \| FR40 FR48 FR68 \| BR38

### DEC21 Private chat images
R1 permits at most three images per message under the same input checks. Store privately and authorize links for at most 60 seconds. Audio, video and private GPS are outside R1.

U-21 \| UC10 \| FR31 FR61 FR69 \| BR26 BR30

### DEC22 Release boundary
R1 is a responsive Arabic and English site covering the defined baseline, contributions, reviews and safety. R2 includes PWA, Web Push, server drafts, saved search and request matching. AI autofill and paid promotion require separate later approval.

U-22 \| UC20 \| FR05 FR70 \| BR39

### DEC23 Implementation architecture
Use a supported Next.js release, a compatible Node LTS runtime, Supabase Postgres/Auth/Storage, a persistent Railway application and worker, Resend email and a Moyasar hosted invoice adapter. Recheck versions before locking dependencies. Operator-owned live accounts are launch prerequisites.

U-23 \| UC18 UC21 UC24 \| FR51 FR54 FR55 FR71 \| BR19 BR20

### DEC24 Retention and deletion
Apply RET01-RET12. Account deletion has a 30 day recovery period; conversations have a bounded inactivity-based period. Evidence holds are narrow and reviewed. Backups, public derivatives and private attachments all have explicit handling.

U-24 \| UC23 \| FR72 FR73 \| BR28 BR40

Approved facility and college names, university domains, operator identity, live payment account and owned domain remain G01-G08 external prerequisites. Implement configuration, validation and clearly marked test fixtures while requesting those values by their deadlines. Do not invent production data or treat missing information as verified.

# 04 Functional requirements and acceptance criteria
FR01-FR80 identifiers remain stable for traceability. Evidence codes describe the origin of the function; decisions and business rules define current limits. Linked tests are acceptance plans, not executed results. The verification chapter provides the full traceability matrix.

## Accounts and discovery

| **ID** | **Requirement**                            | **Acceptance criterion**                                                                                    | **Evidence** |
|--------|--------------------------------------------|-------------------------------------------------------------------------------------------------------------|--------------|
| FR01   | Create an account with an optional college | Validate a 2-50 character name, email and password policy; require email confirmation before market writes. | L S D        |
| FR02   | Sign in with email and password            | Create an authorized session and return only to a permitted local destination.                              | L P          |
| FR03   | Recover account access                     | Return a generic response; expire recovery links after 60 minutes and prevent reuse.                        | L P          |
| FR04   | Protect private operations                 | Check the live session, confirmed email and account state on every private request.                         | L            |
| FR05   | Switch Arabic and English                  | Translate fixed interface text, persist the chosen locale and apply the correct direction.                  | L            |
| FR06   | Show recent listings on the home page      | Open the correct listing from each card and provide a link to the full marketplace.                         | L            |
| FR07   | Search listing titles and descriptions     | Apply a query of up to 100 characters and distinguish no results from a failed request.                     | L            |
| FR08   | Filter by category                         | Return only listings in the selected one of seven categories.                                               | L            |
| FR09   | Filter by item condition                   | Combine condition with the query, category and location using intersection.                                 | L            |
| FR10   | Filter by campus meeting location          | Return only records with the selected active location identifier.                                           | L            |
| FR11   | Sort by recency or price                   | Use a deterministic secondary identifier when primary values are equal.                                     | L            |
| FR12   | Reset marketplace filters                  | Restore default filters, ordering and the first results page.                                               | L            |
| FR13   | Read listing details and images            | Support image selection, line breaks and safe HTTP or HTTPS links; show current status and seller details.  | L            |
| FR14   | Read a public seller profile               | Show join month, public listings and eligible review statistics without exposing private email.             | L            |

## Publication and market management

| **ID** | **Requirement**                    | **Acceptance criterion**                                                                                  | **Evidence** |
|--------|------------------------------------|-----------------------------------------------------------------------------------------------------------|--------------|
| FR15   | Manage favorites                   | Keep one private user-listing relationship and support idempotent removal.                                | S D P        |
| FR16   | Publish through a five step wizard | Complete images, specifications, price, location and review in that order.                                | S            |
| FR17   | Select listing images              | Require 1-10 JPEG, PNG or WebP images, each at most 5 MiB and 24 megapixels.                              | S P          |
| FR18   | Describe an item                   | Require a 5-100 character title, 10-2000 character description, active category and one valid condition.  | S            |
| FR19   | Set price and negotiability        | Accept integer minor units from 0 to 5,000,000; zero means free and disables offers.                      | S            |
| FR20   | Choose a public campus location    | Require an active reference and display the warning against entering a private room address.              | S            |
| FR21   | Review and amend earlier steps     | Preserve text within the tab; request expired images again without losing text.                           | S P          |
| FR22   | Publish exactly once               | Validate all fields and image ownership on the server; a logical retry returns the same listing.          | S P          |
| FR23   | Manage owned listings              | Allow edits only to an active, visible listing owned by the current eligible user.                        | D P          |
| FR24   | Mark sold, archive or restore      | Retain the previous state; restore an owner-archived active listing only within 90 days.                  | D P          |
| FR25   | Browse wanted requests             | Support query, category, location and urgency filters with clear empty states.                            | L            |
| FR26   | Create a wanted request            | Validate the required title, description and category; apply explicit optional budget and location rules. | L D P        |
| FR27   | Manage request status              | Support active, found and closed states with 60 day expiry and one limited reopening.                     | D P          |
| FR28   | Keep a stable conversation context | Do not change the referenced listing or request after conversation creation.                              | P            |

## Conversation negotiation and meetings

| **ID** | **Requirement**                         | **Acceptance criterion**                                                                                                                           | **Evidence** |
|--------|-----------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------|--------------|
| FR29   | Start a contextual conversation         | Return one conversation for the same context, buyer and seller, including retries.                                                                 | L S          |
| FR30   | Read and search the inbox               | Return private summaries, conversation count and a separately defined unread incoming count.                                                       | S            |
| FR31   | Send a message                          | Persist authorized text or image content and expose it only to the participants.                                                                   | S P          |
| FR32   | Show a new conversation state           | Explain messaging, negotiation and campus meeting actions before the first message.                                                                | S            |
| FR33   | Open a price offer form                 | Require an eligible active context with a positive advertised price or stated positive wanted budget.                                              | L S          |
| FR34   | Send a price offer card                 | Accept 100-5,000,000 halalas, keep one pending offer per conversation and expire it after 72 hours.                                                | S P          |
| FR35   | Accept or reject an offer               | Only the seller recipient can decide; use expected version and return 409 on a state conflict.                                                     | S P          |
| FR36   | Keep agreement separate from settlement | Accepting an offer does not reserve the item or prove payment, attendance or delivery.                                                             | P            |
| FR37   | Open a campus meeting form              | Provide location, date, time and an optional note with an explicit displayed timezone.                                                             | S            |
| FR38   | Propose a meeting                       | Schedule at least 30 minutes and at most 30 days ahead; store UTC and display Asia/Riyadh.                                                         | S P          |
| FR39   | Respond to and cancel a meeting         | The recipient accepts or rejects; either party may cancel an actionable meeting; record late cancellation and independent attendance declarations. | P            |
| FR40   | Deliver authorized live updates         | Publish committed events only, recheck membership and account state, and recover gaps through REST.                                                | D P          |
| FR41   | Recover from network interruptions      | Use stable client identifiers and request keys so retries do not duplicate effects.                                                                | P            |
| FR42   | Handle a closed context                 | Reject new offers and meeting proposals while retaining authorized historical reading and permitted text messages.                                 | P            |

## Safety account and support

| **ID** | **Requirement**                               | **Acceptance criterion**                                                                                             | **Evidence** |
|--------|-----------------------------------------------|----------------------------------------------------------------------------------------------------------------------|--------------|
| FR43   | Expose the report action                      | Open a report form from the conversation menu without submitting automatically.                                      | S            |
| FR44   | Block another member                          | Prevent new communication in both directions, retain readable history and permit controlled unblocking.              | S P          |
| FR45   | Record and review reports                     | Keep reason, evidence, review status and decision; do not notify the subject merely because a report was filed.      | L P          |
| FR46   | Publish policy and guidance pages             | Provide Arabic and English privacy, terms and community guidance, with operator details before launch.               | L            |
| FR47   | Review a completed exchange                   | Require a named Deal confirmed by both parties, integer stars 1-5 and a comment up to 500 characters within 30 days. | L D P        |
| FR48   | Read private notifications                    | Only the recipient can read or mark a notification, and its destination must be reauthorized.                        | S D P        |
| FR49   | Edit the account and sign out                 | Protect sensitive changes, confirm email changes, invalidate sessions and remove the BFF cookie on logout.           | S D P        |
| FR50   | Choose an optional contribution               | Offer SAR 10, 15, 30, 50 or a custom amount; update the button label as the amount changes.                          | L S          |
| FR51   | Create a hosted contribution invoice          | Use server-controlled SAR amounts and a unique Moyasar invoice; Stripe describes the reference site only.            | L            |
| FR52   | Handle return from hosted checkout            | A success or back redirect is not payment proof; show the independently verified state.                              | L            |
| FR53   | Verify contribution status on the server      | Authenticate the event, retrieve provider data and match amount, currency, invoice and environment.                  | P            |
| FR54   | Provide an administration area                | Separate moderator and operator powers; cover users, content and cases with MFA, audit and appeal support.           | P            |
| FR55   | Manage reference data                         | Use stable translated identifiers and activation flags; never delete a referenced category or location.              | P            |
| FR56   | Separate platform support from item purchases | Do not create a wallet, escrow or order for the price of a member-to-member item.                                    | L P          |

## Identity and consistency completion

| **ID** | **Requirement**                               | **Acceptance criterion**                                                                                                    | **Evidence** |
|--------|-----------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------|--------------|
| FR57   | Confirm email and resend links                | Use one-time confirmation links, an explicit 24 hour limit and controlled resending.                                        | P            |
| FR58   | Verify optional university email ownership    | Accept only operator-validated domains; a badge proves mailbox control, not current student status.                         | P            |
| FR59   | Reauthenticate and change credentials         | Confirm both addresses for an email change, notify the user and revoke sessions after completion.                           | P            |
| FR60   | Recover in-tab publication text               | Use sessionStorage for non-sensitive text; temporary image references last 24 hours and are revalidated.                    | P            |
| FR61   | Process public and private images             | Validate bytes and dimensions, remove metadata and generate derivatives under the correct access policy.                    | P            |
| FR62   | Prevent duplicate conversations               | Enforce exactly one context and a unique participant pair for each listing or wanted request.                               | P            |
| FR63   | Manage the block list                         | Keep it private; unblocking neither erases history nor removes an administrative restriction.                               | P            |
| FR64   | Maintain a cross-device read cursor           | Keep last_read_seq monotonic, within the same conversation and no later than its committed sequence.                        | P            |
| FR65   | Withdraw or expire offers and cancel meetings | Apply 72 hour offer expiry; preserve historical cards and record late cancellation.                                         | P            |
| FR66   | Identify and confirm the actual exchange      | Allow the seller to name a buyer and record independent confirmations; permit at most one completed exchange per listing.   | P            |
| FR67   | Review cases and appeals                      | Require an authorized reasoned decision and preserve reporter confidentiality.                                              | P            |
| FR68   | Configure notification channels               | Include in-app and email notifications in R1; allow optional email groups to be disabled while retaining security messages. | P            |
| FR69   | Attach private chat images                    | Allow at most three images per message and authorize private download links for at most 60 seconds.                         | P            |
| FR70   | Control release scope                         | Every R1 function has acceptance evidence; PWA, saved search and matching remain later work.                                | P            |

## Operations retention and enforcement

| **ID** | **Requirement**                                 | **Acceptance criterion**                                                                                                | **Evidence** |
|--------|-------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|--------------|
| FR71   | Configure operational and payment environments  | Separate test and live credentials and require launch prerequisites before live collection.                             | P            |
| FR72   | Request and recover account deletion            | Provide a 30 day recovery period without ordinary market writes; recovery preserves administrative restrictions.        | P            |
| FR73   | Retain and purge data under explicit policies   | Execute retention jobs with deletion records and narrowly scoped, reviewed evidence holds.                              | P            |
| FR74   | Enforce rate limits                             | Use atomic central counters keyed by account and trusted IP context; return 429 and Retry-After.                        | P            |
| FR75   | Audit sensitive actions and run background jobs | Commit outbox and inbox records durably and alert on exhausted retries.                                                 | P            |
| FR76   | Back up the database and image objects          | Test a coordinated restoration against the 24 hour RPO and 4 hour RTO targets.                                          | P            |
| FR77   | Manage privileged roles and university domains  | Require operator permission, MFA and audit for role and domain changes.                                                 | P            |
| FR78   | Enforce suspension and restricted appeals       | Reject ordinary private access for restricted accounts while permitting verified, narrowly scoped recovery and appeals. | P            |
| FR79   | Serialize closure and blocking with writes      | Use shared lock ordering and recheck the restriction before committing a conflicting action.                            | P            |
| FR80   | Distinguish recoverable failure states          | Separate failed upload, message or payment processing from empty results; retry without duplication.                    | P            |

# 05 Use cases and alternative flows
An actor is a role in the situation, not a permanent account type; one member may buy in one conversation and sell in another. Authentication is a precondition of private behavior rather than a repeated include call from every case. Each case specifies actor, prerequisites, steps, alternatives and outcome. \[R01\]

![Figure 2 Account, discovery, favorites and identity use cases.](spec-assets/media/image6.png)

Figure 2 Account, discovery, favorites and identity use cases.

![Figure 3 Publication, wanted, conversation, negotiation and exchange use cases.](spec-assets/media/image7.png)

Figure 3 Publication, wanted, conversation, negotiation and exchange use cases.

![Figure 4 Safety, administration, notification and contribution use cases.](spec-assets/media/image8.png)

Figure 4 Safety, administration, notification and contribution use cases.

### UC01 Create an account and confirm email
Actor Visitor

Prerequisites A valid unused email and acceptance of the current policy versions.

1\. Enter name, email and password; choose an optional college.

2\. Create an unconfirmed identity and a profile through an idempotent provisioning flow.

3\. Confirm the one-time 24 hour application link, then sign in normally.

Alternatives and failure Use a generic response for an existing email; resend expired links within quotas. Repair partial profile provisioning without duplicating identity.

Outcome A confirmed account without an automatic university badge.

FR01 \| TC01 TC24 TC25 TC26 TC62 TC68

### UC02 Sign in and recover access
Actor Visitor or member

Prerequisites The identity service is available and the return path is locally allowlisted.

1\. Validate credentials through the BFF and check the current account restriction.

2\. Create a protected server session; require MFA for privileged access.

3\. For recovery, consume the 60 minute link, use a five minute password-reset-only session and revoke existing sessions after success.

Alternatives and failure A restricted account receives only an eligible restricted flow. Authentication failures are generic; provider outage returns a recoverable 503.

Outcome An authorized session or continued visitor access, without provider tokens in the browser.

FR02 FR03 FR04 \| TC02 TC03 TC25 TC26 TC27 TC28 TC63 TC67 TC74

### UC03 Search and filter the marketplace
Actor Visitor or member

Prerequisites Public records and required indexes are available.

1\. Enter a query of at most 100 characters.

2\. Combine category, condition and location; choose recency or price order.

3\. Load 20 records and a stable cursor, open an item or reset the filters.

Alternatives and failure Empty results differ from a request error. Invalid cursors return 400 and hidden records are excluded.

Outcome A deterministic intersection of the selected conditions.

FR06 FR07 FR08 FR09 FR10 FR11 FR12 \| TC04 TC29 TC30 TC81

### UC04 Read a listing and public profile
Actor Visitor or member

Prerequisites A public listing or profile is available.

1\. Read the title, price, condition, location, publication date and images.

2\. Select thumbnails and read plain text with preserved line breaks and safe links.

3\. Open seller details, join month, public listings and visible review statistics.

Alternatives and failure Hidden or purged content returns a generic unavailable state. Sold content shows its current state and disables new negotiation. Missing images have a fallback.

Outcome Public information only, with no private email or conversation disclosure.

FR13 FR14 \| TC05 TC31 TC80 TC81

### UC05 Manage favorites
Actor Confirmed active member

Prerequisites A current authorized session.

1\. Select the favorite control on an available listing.

2\. Insert or remove the unique user-listing relationship idempotently.

3\. Read the private favorites list; show an unavailable placeholder for hidden content without disclosing it.

Alternatives and failure Visitors are directed to sign in. Duplicate saves do not add records; another member’s list is inaccessible.

Outcome Exactly one saved relationship or none.

FR15 \| TC06

### UC06 Publish a listing
Actor Seller

Prerequisites A confirmed active account within publication and upload quotas.

1\. Upload and order 1-10 valid images.

2\. Enter specifications, price and a public campus location; a free item disables negotiation.

3\. Review and submit one logical publication request; the server validates every field and image reference.

Alternatives and failure Rejected or expired images do not erase entered text. Retry with the same request key returns the same result.

Outcome One active listing with ready seller-owned image derivatives.

FR16 FR17 FR18 FR19 FR20 FR21 FR22 FR60 \| TC07 TC08 TC09 TC24 TC25 TC32 TC33 TC64 TC65 TC66 TC68 TC75 TC82

### UC07 Manage a listing and identify an exchange
Actor Listing owner

Prerequisites Ownership, a current version and a state permitting the action.

1\. Edit an active visible listing, archive it or mark it sold.

2\. Retain archive reason and previous state; never reactivate sold content.

3\. If the buyer is known, initiate a separate Deal in an eligible conversation and request their independent confirmation.

Alternatives and failure An external sale may be marked sold without a Deal or review. Administrative hiding cannot be reversed by the owner. A state conflict returns 409.

Outcome Consistent listing state and a separately governed exchange record.

FR23 FR24 \| TC10 TC34 TC35 TC36 TC45

### UC08 Create a wanted request
Actor Requester

Prerequisites A confirmed active member.

1\. Enter a 5-100 character title, 10-1000 character description and category.

2\. Optionally set location and a budget; indicate urgency.

3\. Publish one active request with initial expiry 60 days after creation.

Alternatives and failure Null budget means unspecified; zero means a free-item request. Reject invalid fields and duplicate logical publication.

Outcome A stable request identifier linked to its owner.

FR25 FR26 \| TC11 TC37

### UC09 Close or reopen a wanted request
Actor Request owner

Prerequisites Ownership and the current version.

1\. Edit an active request or mark it found or closed.

2\. Preserve the original creation time and disable new negotiation when closed.

3\. Reopen once within 30 days of first closure and within the absolute 90 day lifetime limit.

Alternatives and failure Reject a second reopening, an expired window or a restricted account. Expiry jobs are idempotent.

Outcome A consistent state and expiry without changing existing conversation context.

FR27 \| TC10 TC11 TC38 TC45 TC78

### UC10 Exchange messages and read history
Actor Conversation participants

Prerequisites An eligible account and authorized participation; new conversations require an active public context.

1\. Create or obtain the single contextual conversation with server-derived buyer and seller roles.

2\. Send text or up to three private images using a stable logical message identifier.

3\. Persist sequence, content and outbox together; recover updates through REST and advance the read cursor only over eligible messages.

Alternatives and failure Reject third-party access, blocked new communication and restricted accounts. A network interruption after commit returns the same saved message on retry.

Outcome A private ordered record with recoverable delivery and no duplicated message.

FR29 FR30 FR31 FR32 FR62 FR69 \| TC12 TC13 TC24 TC25 TC30 TC31 TC32 TC39 TC40 TC41 TC42 TC62 TC63 TC64 TC65 TC66 TC68 TC75

### UC11 Send or withdraw a price offer
Actor Buyer

Prerequisites An active eligible context with positive price or a stated positive wanted budget, and no block.

1\. Read the reference amount and enter SAR 1-50,000.

2\. Send one pending offer card with a 72 hour lifetime.

3\. Withdraw before a recipient decision; a later offer is allowed after the previous one closes.

Alternatives and failure Reject free or otherwise ineligible contexts, a second pending offer and late acceptance. The sender cannot withdraw an already accepted offer.

Outcome A contextual offer with explicit parties and expiry.

FR33 FR34 \| TC14 TC25 TC43 TC44 TC73

### UC12 Decide a price offer
Actor Seller recipient

Prerequisites The offer is pending, unexpired and belongs to an active unblocked context.

1\. Read amount, sender and expiry.

2\. Submit accept or reject with expected version and an idempotency key.

3\. Commit one conditional transition and notify the buyer from the committed event.

Alternatives and failure The sender cannot accept. A conflicting decision returns 409; a true logical retry returns the saved result.

Outcome One preliminary price decision, without a reservation or automatic sale.

FR35 \| TC15 TC43 TC44 TC45

### UC13 Propose a campus meeting
Actor Either participant

Prerequisites An eligible active conversation and context without a block.

1\. Choose an active public location, date and time; add a note up to 500 characters.

2\. Display Asia/Riyadh and warn against a private room address.

3\. Submit a UTC timestamp at least 30 minutes and at most 30 days ahead; set the other participant as recipient.

Alternatives and failure Reject invalid time or location. Rescheduling creates a linked replacement proposal rather than editing historical terms.

Outcome A proposed meeting with explicit time, place and recipient.

FR37 FR38 \| TC16 TC46

### UC14 Respond to or cancel a meeting
Actor Recipient or either cancelling participant

Prerequisites A permitted participant and a transition allowed by the current state.

1\. The recipient accepts or rejects before the scheduled time.

2\. Either party cancels a proposed or accepted meeting; retain a late flag for the last hour or later.

3\. Within 72 hours after the time, each party may record their own attendance declaration without confirming the other party or completing a Deal.

Alternatives and failure An unanswered proposal expires at its time. Blocking still permits cancellation. Retain attendance declarations even when an accepted meeting is later cancelled.

Outcome An auditable coordination record, without payment or delivery proof.

FR39 \| TC16 TC47 TC77

### UC15 Report content or a conversation
Actor Authorized member

Prerequisites The reporter is eligible and can read the target; a blocked relationship does not remove reporting access.

1\. Choose one of seven reasons and provide up to 2000 characters, with 10-2000 required for Other.

2\. Store narrowly scoped evidence and return a private tracking reference.

3\. Read received, in-review and closed status through the member’s own reports view.

Alternatives and failure Return the existing reference for a matching report within 24 hours. A guessed private target is not reportable. No automatic punishment follows filing.

Outcome A reviewable report with confidential reporter identity.

FR43 FR45 FR46 \| TC18 TC48 TC76

### UC16 Block or unblock another member
Actor Member with an established relationship

Prerequisites The target is another member known through an authorized context.

1\. Read the effect and confirm the block.

2\. Save the relationship under shared pair locking; cancel pending offers and future meetings with a reason.

3\. Remove only the caller’s block through the private block list.

Alternatives and failure Idempotent repeats do not duplicate records. The other party’s block remains effective. Do not revive cancelled records or lift an administrative ban.

Outcome New communication prevented in both directions after commit, with permitted historical access retained.

FR44 \| TC17 TC45 TC49

### UC17 Confirm an exchange and review
Actor Named exchange parties

Prerequisites The seller owns the referenced listing; the buyer is the other contextual participant.

1\. The seller initiates a Deal, identifies the buyer and confirms their own handover.

2\. The buyer independently confirms completion; only then does the Deal become completed and the listing become sold if still active.

3\. Each party may submit one integer 1-5 star review with an optional comment up to 500 characters within 30 days.

Alternatives and failure Reject self-exchange, a conflicting current Deal and early or duplicate reviews. Permit a pending cancellation; route a completed exchange complaint to a dispute without erasing its history. Cancel an uncompleted pending Deal after seven days without both confirmations, without reactivating a sold listing.

Outcome At most one completed Deal per listing and one review per party, without independently proving external payment.

FR47 \| TC19 TC36 TC47 TC50 TC51 TC78 TC79 TC80 TC83

### UC18 Make an optional contribution
Actor Contributor and payment provider

Prerequisites A contribution page and a configured test or live environment.

1\. Choose SAR 10, 15, 30, 50 or a custom amount between 10 and 500.

2\. Create a server-controlled record and hosted invoice, then redirect to the allowlisted provider.

3\. Authenticate an incoming event and independently verify invoice, payment, amount, currency and environment.

4\. Show the verified status; reconcile when an event is missing.

Alternatives and failure A return URL is not proof. Keep an unknown invoice-creation outcome for reconciliation, without a blind duplicate invoice.

Outcome One optional support contribution, separate from item purchases and without card data in the application.

FR50 FR51 FR52 FR53 FR56 \| TC22 TC23 TC24 TC52 TC53 TC54 TC62 TC64 TC70 TC84

### UC19 Read notifications and choose channels
Actor Notification recipient

Prerequisites The recipient has eligible access to the notification and destination.

1\. Read the private in-app feed.

2\. Reauthorize the referenced destination when opening it.

3\. Mark read and manage optional email groups; security messages remain required.

Alternatives and failure A deleted context is unavailable. Email failure does not remove the in-app event. Deduplicate event delivery.

Outcome A private 90 day notification history with explicit channel preferences.

FR48 \| TC20 TC39 TC55

### UC20 Manage the account and sign out
Actor Account owner

Prerequisites A valid session; sensitive changes require reauthentication within five minutes.

1\. Edit permitted profile, avatar, college and locale fields; review owned activity and blocks.

2\. Change password or complete confirmation of both old and new login email addresses.

3\. Sign out by revoking the server session, clearing the cookie and closing private live channels.

Alternatives and failure Reject client-supplied roles, badge or reputation fields. Reject stale versions and already-used email destinations.

Outcome An updated profile or a revoked session without identity secrets in local draft storage.

FR05 FR49 FR70 \| TC21 TC27 TC31 TC42 TC55 TC56 TC64 TC65 TC68 TC74 TC75 TC81 TC82

### UC21 Review a report and appeal
Actor Moderator or operator

Prerequisites An authorized privileged role, MFA and a current administrative session.

1\. Read an assigned case and record access to its limited evidence.

2\. Dismiss the allegation or apply an authorized warning, content hide, suspension or operator-only permanent ban.

3\. Notify the affected party with a reason and a 14 day appeal route; assign the appeal to a different reviewer where available.

Alternatives and failure Prevent self-review and out-of-scope evidence access. Conflicting decisions return 409. Keep held evidence out of automatic purge.

Outcome A reasoned decision, audit trail and privacy-preserving notifications.

FR54 FR76 \| TC28 TC35 TC48 TC51 TC57 TC60 TC63 TC65 TC67 TC69 TC71 TC72 TC76 TC79

### UC22 Verify a university mailbox
Actor Confirmed active member

Prerequisites An operator-validated university domain is enabled.

1\. Enter the university email independently of the login address.

2\. Receive a separate one-time 24 hour application verification link.

3\. Confirm and show a limited mailbox ownership badge; renew after one year.

Alternatives and failure Reject public or unapproved domains. Revocation, change or expiry removes the badge. The member cannot set verification fields.

Outcome Mailbox proof with no claim of current student status or extra access.

FR58 \| TC58

### UC23 Request or recover account deletion
Actor Account owner

Prerequisites Recent verified reauthentication and an account that has not been purged.

1\. Read the deletion consequences and request a 30 day recovery period; revoke normal sessions and hide owned content.

2\. Recover through a purpose-limited identity check within the period, preserving any existing ban or suspension.

3\. After the period, remove login identity and identifying profile data and apply content, conversation and evidence retention separately.

Alternatives and failure A reviewed evidence hold retains only necessary data. Recovery is unavailable after purge. Pseudonymization is not a claim that all free-text personal data has disappeared.

Outcome Controlled deletion or recovery with a deletion ledger and no ordinary writes during the pending period.

FR72 \| TC59 TC60 TC71 TC83

### UC24 Manage categories locations and university domains
Actor Catalog manager or operator

Prerequisites MFA and the appropriate independent permission for the relevant reference type.

1\. Create stable keys and Arabic and English labels with ordering and active state.

2\. Deactivate a used reference without deleting it; existing records remain interpretable.

3\. Only an operator approves a university domain, records its source and manages role grants.

Alternatives and failure Reject normalized duplicate labels, public email domains and deletion of referenced values. Catalog permission does not permit role or domain administration.

Outcome Consistent reference data with an auditable seed source and no broken historical references.

FR55 \| TC28 TC57 TC61 TC80

# 06 Business rules and state lifecycles
Enforce these rules on the server and use database constraints where the invariant can be expressed accurately. Interface validation helps users but grants neither ownership nor authority and does not replace transactional checks. Compare deadlines with server time after acquiring the required locks.

| **ID** | **Rule**                                                                                                                                                                                                                |
|--------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| BR01   | Market writes require an active session, a confirmed email and an active account. Signup, recovery and guest contributions use their own restricted flows.                                                              |
| BR02   | Selecting a college does not verify affiliation. A university email badge proves mailbox ownership only and grants no additional privilege.                                                                             |
| BR03   | The catalog has seven stable category keys. Locations, colleges and categories have translated labels and controlled duplicate detection.                                                                               |
| BR04   | One of five item conditions is required. Item condition is independent of a listing’s publication state.                                                                                                                |
| BR05   | Titles contain 5-100 characters and listing descriptions 10-2000 after trimming. Store plain text, preserve line breaks and safely linkify HTTP or HTTPS URLs.                                                          |
| BR06   | Publishing requires 1-10 images. Each input is at most 5 MiB and 24 megapixels and must decode as an allowed image type.                                                                                                |
| BR07   | Marketplace money is an integer number of halalas in SAR, from 0 to 5,000,000. Reject extra precision rather than silently rounding.                                                                                    |
| BR08   | A zero price means free. Disable negotiation and offer cards, while retaining chat, meeting and exchange confirmation.                                                                                                  |
| BR09   | An offer is 100-5,000,000 halalas. The buyer sends it to the seller in an eligible active context.                                                                                                                      |
| BR10   | Meeting locations are approved public campus facilities. Do not collect a room address or private GPS coordinates.                                                                                                      |
| BR11   | Members edit their own permitted content. Administrative action must be authorized, reasoned and audited, without impersonating a member.                                                                               |
| BR12   | An accepted offer is a preliminary price agreement. It does not reserve an item or prove payment or delivery.                                                                                                           |
| BR13   | Only the seller recipient decides a pending, unexpired offer using an atomic status and version check. A conflicting decision returns 409.                                                                              |
| BR14   | Store UTC timestamps and display meetings in Asia/Riyadh. New proposals must be 30 minutes to 30 days ahead.                                                                                                            |
| BR15   | Meeting attendance is a separate declaration by each participant after the scheduled time. It does not complete a Deal or enable a review.                                                                              |
| BR16   | A member-to-member block is private and separate from account suspension or a permanent administrative ban.                                                                                                             |
| BR17   | A report is an allegation requiring review. Filing it does not automatically penalize or notify the subject.                                                                                                            |
| BR18   | Each party may submit one integer 1-5 star review per completed Deal within 30 days. Self-review is prohibited.                                                                                                         |
| BR19   | Contributions are optional, one-time support. They do not affect search ranking, permissions or payment for listed items.                                                                                               |
| BR20   | Record paid status only from authenticated provider information independently retrieved and matched by the server.                                                                                                      |
| BR21   | Confirmation links last at most 24 hours, recovery links at most 60 minutes, and each is consumed once. Return destinations are local and allowlisted.                                                                  |
| BR22   | University mailbox verification is separate from login email. Revoking or changing that verified mailbox removes its badge.                                                                                             |
| BR23   | Require recent reauthentication and confirmation of both old and new login email addresses before replacement. Notify the member and revoke existing sessions.                                                          |
| BR24   | The identity provider stores password hashes. Accept 15-64 Unicode characters subject to bcrypt’s 72 UTF-8 byte limit, without silent truncation or mandatory character classes.                                        |
| BR25   | R1 stores only non-sensitive draft text in the current tab and revalidates temporary image references for 24 hours. Server drafts are R2 work.                                                                          |
| BR26   | Chat attachments remain private. Issue links for at most 60 seconds after authorization and purge all relevant derivatives under retention policy.                                                                      |
| BR27   | A sold listing never returns to active. Restore an owner-archived active listing only within 90 days; administrative hiding is independently controlled.                                                                |
| BR28   | Archiving is not permanent deletion. Retention, evidence holds and referential integrity determine purge behavior.                                                                                                      |
| BR29   | A conversation references exactly one listing or wanted request. Buyer and seller differ, and a unique pair applies within each context.                                                                                |
| BR30   | A block in either direction prevents new messages, offers, meeting proposals and Deals in both directions. Authorized history, reporting, cancellation and a pre-existing Deal confirmation remain separately governed. |
| BR31   | Read state uses message sequence numbers, not UUID order. The cursor never decreases; unread counts exclude the reader’s own and system messages.                                                                       |
| BR32   | Idempotency keys bind actor, route and normalized payload. A changed payload conflicts; committed events are published only after the transaction succeeds.                                                             |
| BR33   | Keep one pending offer per conversation; allow withdrawal and expire after 72 hours. Preliminary acceptance in another conversation is not a reservation.                                                               |
| BR34   | The recipient accepts or rejects a proposal before its time. Cancellation remains available for proposed or accepted meetings, including a late cancellation record; rescheduling creates a new linked proposal.        |
| BR35   | Allow one pending, disputed or completed Deal per listing. The seller identifies the buyer; each confirms independently, and there is no self-exchange.                                                                 |
| BR36   | Administrative decisions require a recorded reason and audit. Moderators may suspend for 7 or 30 days; only operators may ban permanently. Appeals are accepted for 14 days.                                            |
| BR37   | A wanted request expires after 60 days. It may reopen once within 30 days of first closure and never remain active beyond day 90 from creation.                                                                         |
| BR38   | Notifications are private. Optional email respects preferences; security email cannot be disabled, and chat text is not sent by email.                                                                                  |
| BR39   | R1 includes all baseline market, support and safety functions. Deferring any R1 function requires an explicit scope change.                                                                                             |
| BR40   | Account deletion has a 30 day recovery period. Retention is bounded; evidence holds need a documented reason and monthly review.                                                                                        |

## Publishing a listing
![Figure 5 Publication activity from media processing to review and commit. Back navigation preserves eligible inputs and publication revalidates everything.](spec-assets/media/image9.png)

Figure 5 Publication activity from media processing to review and commit. Back navigation preserves eligible inputs and publication revalidates everything.

## Listing and archive lifecycle
![Figure 6 Active-origin and sold-origin archives are distinct. Restore neither lifts administrative hiding nor returns sold content to active.](spec-assets/media/image10.png)

Figure 6 Active-origin and sold-origin archives are distinct. Restore neither lifts administrative hiding nor returns sold content to active.

Sold content remains visible for 180 days and then archives. Archived content is retained for 365 days before purge, subject to a scoped evidence hold. The 90 day restore window applies only to an owner archive of an active listing, not permanent deletion. If a retained conversation or Deal needs a reference, keep a minimal pseudonymous identifier and remove purged description and image snapshots.

## Offer and wanted request lifecycles
![Figure 7 One pending offer per conversation with conditional version and expiry checks. Acceptance is a preliminary price agreement, not a reservation.](spec-assets/media/image11.png)

Figure 7 One pending offer per conversation with conditional version and expiry checks. Acceptance is a preliminary price agreement, not a reservation.

![Figure 8 Initial 60 day expiry and one reopening limited by both closure time and the absolute 90 day lifetime.](spec-assets/media/image12.png)

Figure 8 Initial 60 day expiry and one reopening limited by both closure time and the absolute 90 day lifetime.

On reopening, expiry is the earlier of reopen time plus 30 days and creation time plus 90 days. Do not reset creation or first-closure timestamps. Reject a stale update if a concurrent closure or expiry has already committed.

An offer preserves the reference price or budget at submission while the context card shows the current amount. Context closure cancels pending offers and unanswered meeting proposals but preserves accepted meetings and cancellation rights. Making a listing free or non-negotiable, or removing or zeroing a request budget, cancels pending offers with a reason. Blocking also cancels future accepted meetings.

## Meeting and attendance declarations
![Figure 9 Decide a proposal before its time. Attendance is a separate per-party record and never completes an exchange.](spec-assets/media/image13.png)

Figure 9 Decide a proposal before its time. Attendance is a separate per-party record and never completes an exchange.

Rescheduling creates a new proposal linked to the original rather than silently editing an accepted time. Accepting a replacement cancels the prior meeting atomically with a replacement reason; rejecting it leaves the original unchanged. Check context and blocking at proposal and acceptance, while still permitting cancellation under a block.

Cancellation is late during the hour before the scheduled time or later. Within 72 hours after an accepted or late-cancelled meeting, a participant may declare their own attendance once. They cannot declare for the other party or edit the declaration. A complaint is reviewed as a report, not automatic proof of misconduct.

## Account restrictions and deletion
![Figure 10 Administrative restrictions and deletion are independent dimensions. Recovery does not lift a ban or confirm email.](spec-assets/media/image14.png)

Figure 10 Administrative restrictions and deletion are independent dimensions. Recovery does not lift a ban or confirm email.

An unconfirmed account can browse public content and resend confirmation but cannot upload, publish or communicate. A restricted account has no ordinary private access or new live delivery and uses verified limited appeal or privacy flows. A member block does not suspend the account and leaves history readable and reportable to otherwise eligible participants. These restrictions are distinct.

Public queries exclude content owned by a restricted or deletion-pending account as well as archived or hidden content. This does not change business state; lifting a restriction cannot restore separately moderated or purged content. An eligible active participant can still read history when the other party is restricted. Reading checks the reader and membership; new communication checks both parties.

## Exchange review and dispute lifecycle
![Figure 11 The seller starts and confirms their handover; the buyer confirms independently. A dispute preserves history and does not prove an external payment refund.](spec-assets/media/image15.png)

Figure 11 The seller starts and confirms their handover; the buyer confirms independently. A dispute preserves history and does not prove an external payment refund.

A new Deal may use an active listing, or a non-archived sold listing within 30 days of being marked sold when no non-cancelled Deal exists. A wanted conversation also requires an active request and an eligible listing owned by its seller. On both confirmations, mark the listing sold and the request found if still active; do not silently rewrite an already closed request.

Only pending Deals may be cancelled, and cancellation never reactivates sold content. A post-completion dispute preserves confirmations and completion time while pausing review visibility and eligibility. An independent reviewer restores completed status or voids eligibility; a replacement Deal cannot bypass a completed or disputed exchange. The review window remains 30 days from original completion.

A pending Deal expires seven days after creation if both confirmations are absent; cancel it for confirmation timeout and notify the parties. The confirmation operation checks the deadline even if the worker is delayed. This never reactivates sold content. The explicit design limit prevents indefinite pending records and is covered by TC36.

A member block does not prevent confirmation of a pre-existing Deal if both accounts remain eligible and no dispute is open, but prevents a new Deal. An administrative restriction stops that account’s private operations; the other party can report or contact support. Administrators cannot confirm delivery for a restricted member.

# 07 Architecture integration and concurrency
R1 uses one modular application for the interface and its services, plus a separate worker for media, notifications, reconciliation and retention. The defined scope does not require separate microservices. Pin a supported Next.js release and compatible Node LTS runtime; Next.js 16 was supported when this choice was reviewed. \[R19\]

![Figure 12 UI, BFF session boundary, domain modules, storage and worker responsibilities. Dashed arrows are component dependencies, not event order.](spec-assets/media/image16.png)

Figure 12 UI, BFF session boundary, domain modules, storage and worker responsibilities. Dashed arrows are component dependencies, not event order.

Railway hosts a persistent Node process and WebSocket connections with a separate worker. Supabase supplies authentication, Postgres and storage, Resend sends email, and a payment adapter creates hosted Moyasar invoices. The adapter keeps provider details out of listing and conversation logic; this is the new product architecture, not a change performed on the reference site. \[R20\]

![Figure 13 Production nodes, execution environments, connections and secret boundaries. Actual domains and service accounts are launch prerequisites.](spec-assets/media/image17.png)

Figure 13 Production nodes, execution environments, connections and secret boundaries. Actual domains and service accounts are launch prerequisites.

## Data flow and system boundary
![Figure 14 Member, administrator, payment and email data flows. Card details do not enter the application.](spec-assets/media/image18.png)

Figure 14 Member, administrator, payment and email data flows. Card details do not enter the application.

![Figure 15 Identity, market, communication, safety and contribution processes, their stores and external entities.](spec-assets/media/image19.png)

Figure 15 Identity, market, communication, safety and contribution processes, their stores and external entities.

Messages, offers, meetings, Deals and notifications are private; only approved published-listing images may be public. A reviewer receives evidence for an authorized case, not a copy of every message. DFD shapes describe data movement, not separate deployed processes.

## Locking and atomic writes
Messaging, blocking, closure and account enforcement use one lock order: account-control rows sorted by identifier, participant-pair lock, context, conversation, then offer, meeting or Deal. Recheck state and ownership after locking. Multiple records of the same kind are also locked in a consistent identifier order.

Allocate message_seq while holding the conversation lock, and commit message, optional structured card and outbox event together. Offer acceptance fails if state, version or expiry no longer matches. Return 409 for state conflicts; retry transient transaction failures at most three times with short backoff and the same request key. Never blindly repeat an unknown financial side effect.

![Figure 16 Offer and decision sequence after authorization, followed by notification from the committed event.](spec-assets/media/image20.png)

Figure 16 Offer and decision sequence after authorization, followed by notification from the committed event.

## Read state and live updates
The client submits through_seq after displaying a contiguous message range, or explicitly requests mark-all-read. Store the greater of the prior cursor and eligible cursor; reject another conversation’s sequence or a value beyond the committed last message. Count incoming messages beyond the cursor, excluding self-sent and system messages. UUIDs identify records and never determine chronological order.

The outbox is durable truth; Postgres LISTEN/NOTIFY may be used only as a wake-up hint through an appropriate dedicated connection. Hints do not contain message text; the application loads the committed event and reauthorizes it. Start with one application replica and one worker. Multiple replicas require tested shared fanout, while quota counters are centralized from the outset.

After reconnection or a detected gap, the client resumes through REST from its last confirmed sequence. A WebSocket event is not the only evidence of persistence. Recheck session, account, membership and blocking before delivering a new message; separately permitted cancellation and prior-Deal events may still be delivered. Logout or revocation closes private subscriptions.

## Environment separation and source handover

| **Environment** | **Use**                                                                 | **Boundary**                                                        |
|-----------------|-------------------------------------------------------------------------|---------------------------------------------------------------------|
| Development     | Local development, fixtures and test keys.                              | No member data or production secrets.                               |
| Staging         | Separate data, auth and storage project with sandbox payment and email. | Block indexing and isolate domain and dependencies from production. |
| Production      | Project-owned services and accepted build artifact.                     | Least privilege, MFA, monitoring and independent backups.           |
| Backups         | Independent account, encryption key and media manifest.                 | One secret cannot delete both source and all backups.               |

apps/web UI, BFF, authorized WebSocket server

apps/worker media, outbox, retention, reconciliation

packages/domain rules, schemas, permissions, transitions

packages/db migrations, constraints, RLS policies

packages/i18n Arabic and English resource keys

tests unit, integration, E2E, load, security

ops deployment, backups, recovery runbooks

docs API, decisions, acceptance records

# 08 Data model and field dictionary
Separate login identity from the profile that can be pseudonymized so deleting provider identity does not erase retained history or break Deal references. Diagrams show principal relationships; the dictionary and invariants complete the omitted fields. These are design definitions; production requires actual migrations and constraint tests.

![Figure 17 Identity, sessions, roles and mailbox verification relationships.](spec-assets/media/image21.png)

Figure 17 Identity, sessions, roles and mailbox verification relationships.

![Figure 18 Market, wanted, media and favorites relationships.](spec-assets/media/image22.png)

Figure 18 Market, wanted, media and favorites relationships.

![Figure 19 Conversation, message, offer, meeting and attendance relationships.](spec-assets/media/image23.png)

Figure 19 Conversation, message, offer, meeting and attendance relationships.

![Figure 20 Deal, review, report, action, appeal and block relationships.](spec-assets/media/image24.png)

Figure 20 Deal, review, report, action, appeal and block relationships.

![Figure 21 Contribution, provider event, notification and preference relationships.](spec-assets/media/image25.png)

Figure 21 Contribution, provider event, notification and preference relationships.

![Figure 22 Operational records with functional dependencies; dashed arrows are not foreign keys.](spec-assets/media/image26.png)

Figure 22 Operational records with functional dependencies; dashed arrows are not foreign keys.

## Field and value conventions
Identifiers are UUIDv4 except message and outbox sequences, which use bigint. A trailing question mark means nullable; other fields are required unless a default is stated. PK denotes a primary key and FK a reference. Use UTC timestamptz and integer halalas. Add created_at and updated_at to mutable records, not arbitrary deleted_at fields on immutable records.

Access depends on session, ownership, relationship and state, not knowing a UUID. Purge content and personal identifiers under the relevant retention policy, keeping only minimal pseudonymous references where retained history needs them. Do not cascade from provider identity into conversation history.

### IdentityAccount
Login identity managed by the authentication provider.

id uuid PK \[auth.users\]

email provider-managed; email_confirmed_at timestamptz?

password_hash provider-managed; provider_id text

Do not store a password in application tables or expose email publicly. Deleting provider identity must not cascade-delete retained conversation history.

RET06

### Profile
Member profile fields used by public and private account views.

id uuid PK; auth_user_id uuid UNIQUE?

display_name varchar(50); college_id uuid FK?

avatar_id uuid FK?; locale varchar(2); version integer

joined_at timestamptz; deleted_at timestamptz?

Keep a stable profile identifier after unlinking the login identity. Retain only a minimal pseudonymous reference when history needs it. The client cannot edit roles or rating aggregates.

RET06

### AccountControl
Account restrictions independent of email confirmation.

user_id uuid PK/FK Profile

status enum(active,suspended,banned); suspended_until timestamptz?

deletion_requested_at timestamptz?; token_version integer

restriction_reason_ref uuid?; version integer

Pending deletion is independent of restriction state. Recovery does not lift a ban and suspension expiry does not confirm email. Check the current record on requests and delivery.

RET06 RET08

### RoleGrant
Privileged role assignment and revocation.

id uuid PK; user_id uuid FK; role enum

granted_by uuid FK; granted_at timestamptz

revoked_at timestamptz?; reason text

One active grant per member and role. Operator-only grant and revocation require reauthentication and audit; protect the last active operator.

RET08

### UniversityDomain
An operator-approved university mailbox domain.

id uuid PK; domain_ascii text UNIQUE

is_active boolean; evidence_ref text

verified_by uuid FK; verified_at timestamptz; version integer

Normalize domains and match the entire approved domain, never a substring. Reject public mail domains. Start with an empty list until operator approval.

RET08

### UniversityVerification
University mailbox proof independent of login email.

id uuid PK; user_id uuid FK; domain_id uuid FK

email_ciphertext bytea; email_lookup_hash bytea

verified_at timestamptz; expires_at timestamptz

revoked_at timestamptz?; version integer

One active proof per member for one year. Revoke its badge on mailbox change, proof revocation or domain deactivation; it is not proof of current student status.

RET06 RET12

### Category
The seven item categories.

id uuid PK; key text UNIQUE

label_ar varchar(120); label_en varchar(120)

display_order integer; is_active boolean; source_ref text

version integer

Use a stable identifier, two labels and a seed source. Deactivate referenced values instead of deleting them; do not invent unapproved college or facility names.

Reference data

### College
Optional college choices in member profiles.

id uuid PK; key text UNIQUE

label_ar varchar(120); label_en varchar(120)

display_order integer; is_active boolean; source_ref text

version integer

Use a stable identifier, two labels and a seed source. Deactivate referenced values instead of deleting them; do not invent unapproved college or facility names.

Reference data

### CampusLocation
Approved public campus meeting facilities.

id uuid PK; key text UNIQUE; kind enum(housing,library,faculty,other)

label_ar varchar(120); label_en varchar(120)

display_order integer; is_active boolean; source_ref text

version integer

Use a stable identifier, two labels and a seed source. Deactivate referenced values instead of deleting them; do not invent unapproved college or facility names.

Reference data

### AppSession
Application session whose identity secrets remain on the server.

id_hash bytea PK; user_id uuid FK?; scope enum

provider_tokens_ciphertext bytea?; token_version integer

created_at, expires_at, last_seen_at timestamptz

step_up_until, mfa_verified_at, revoked_at timestamptz?

Scope is normal, recovery, appeal, deletion_recover, guest or mfa_challenge. Restricted scopes have no market authority. Delete provider secrets on revocation and serialize refresh-token rotation per session.

RET12

### AuthFlow
One-time application link for an authentication purpose.

id_hash bytea PK; user_id uuid FK?; purpose enum

provider_token_ciphertext bytea?; email_lookup_hash bytea

flow_group_id uuid?; destination enum?

expires_at timestamptz; consumed_at timestamptz?; state enum

Generate a random 256-bit token and store its hash. Bind purpose, destination and expiry; email change links share a flow group for the two addresses. issued, processing, consumed and failed states support safe recovery after interruption.

RET12

### Listing
Listing content and publication lifecycle.

id uuid PK; seller_id uuid FK; category_id uuid FK

location_id uuid FK; title varchar(100); description text

condition enum; price_minor integer; currency char(3)=SAR

is_negotiable boolean; status enum(active,sold,archived)

previous_status enum?; archive_reason enum?

sold_at, archived_at, moderation_hidden_at timestamptz?

version integer; created_at, updated_at timestamptz

Title 5-100 and description 10-2000; price 0-5,000,000 halalas. Administrative hiding is independent and sold never returns to active. Archive and previous-state fields belong to this table, not a duplicate lifecycle entity.

RET03

### MediaAsset
Member-owned media asset bound to one purpose.

id uuid PK; owner_id uuid FK; purpose enum(listing,chat,avatar)

context_id uuid?; quarantine_key text UNIQUE

status enum(pending,uploaded,processing,ready,rejected,deleted)

bytes bigint; mime text; width,height integer; sha256 bytea

expires_at, detached_at timestamptz?; created_at timestamptz

The worker checks actual content and rejects animation and unsupported types. Bind an asset to one context and do not reuse private chat media publicly. Raw uploads are never public.

RET01 RET03 RET04 RET06

### MediaDerivative
Processed image variants with explicit access policy.

id uuid PK; media_id uuid FK; variant enum

object_key text UNIQUE; bytes bigint; sha256 bytea

visibility enum(private,public); longest_edge integer

created_at timestamptz; deleted_at timestamptz?

Keep a processed private master and 150, 600 and 1200 pixel variants without upscaling. Publish approved listing derivatives only after publication; remove public access on hiding or archiving, retaining the private processed master under retention.

Same as parent asset

### ListingImage
Ordered listing image relationships.

listing_id uuid FK; media_id uuid FK UNIQUE

position smallint; PRIMARY KEY(listing_id,position)

Require 1-10 ready seller-owned images at publication, unique positions and one listing context per asset.

RET03

### WantedRequest
Wanted request with explicit budget and state.

id uuid PK; requester_id uuid FK; category_id uuid FK

location_id uuid FK?; title varchar(100); description text

budget_minor integer?; urgent boolean; status enum(active,found,closed)

closed_reason enum?; first_closed_at,closed_at timestamptz?

reopen_count smallint=0; expires_at timestamptz

moderation_hidden_at timestamptz?; version integer

created_at,updated_at timestamptz

Null is unspecified and zero requests a free item. Title 5-100 and description 10-1000. Preserve first closure time and the 90 day lifetime cap; purge closed request content after 365 days.

RET03

### Favorite
Private saved-listing relationship.

user_id uuid FK; listing_id uuid FK

created_at timestamptz; PRIMARY KEY(user_id,listing_id)

Enforce uniqueness; saving does not grant access to subsequently hidden content.

RET03 RET06

### Conversation
A stable context for two named participants.

id uuid PK; listing_id uuid FK?; wanted_id uuid FK?

buyer_id uuid FK; seller_id uuid FK; last_seq bigint=0

context_snapshot jsonb; last_activity_at timestamptz

archived_at timestamptz?; version integer

Exactly one context and two different members. Use a partial unique index for each context type and participant pair. Keep only a limited title, amount and approved thumbnail snapshot, never a public reference to private media.

RET04

### ConversationMember
Per-participant read state.

conversation_id uuid FK; user_id uuid FK

last_read_seq bigint=0; joined_at timestamptz

PRIMARY KEY(conversation_id,user_id)

Exactly the two contextual participants. The cursor is monotonic, no later than last_seq and cannot reference another conversation.

RET04

### Message
A message or structured contextual card.

id uuid PK; conversation_id uuid FK; message_seq bigint

sender_id uuid FK; type enum(text,image,offer,meetup,system)

body text?; client_message_id uuid; created_at timestamptz

UNIQUE(conversation_id,message_seq)

UNIQUE(conversation_id,sender_id,client_message_id)

Text is 1-2000 characters when present. Ordinary messages require text or an image. Structured cards come from their domain operations; clients cannot impersonate system messages.

RET04

### MessageAttachment
Ordered private message images.

message_id uuid FK; media_id uuid FK UNIQUE

position smallint; PRIMARY KEY(message_id,position)

Zero to three images depending on text. Match owner, purpose, context and ready state; never issue a permanent download link.

RET04

### PriceOffer
Formal price offer linked to a message card.

id uuid PK; message_id uuid UNIQUE FK; conversation_id uuid FK

buyer_id,seller_id uuid FK; amount_minor integer

reference_minor integer; reference_kind enum(listing_price,wanted_budget)

status enum(pending,accepted,rejected,withdrawn,expired,cancelled)

expires_at,responded_at timestamptz?; version integer

Amount 100-5,000,000 halalas. A partial unique index prevents two pending offers per conversation. Recipient decision and sender withdrawal require current state, expiry and version checks.

RET04

### Meetup
Proposal to coordinate a meeting time and place.

id uuid PK; message_id uuid UNIQUE FK; conversation_id uuid FK

proposer_id,recipient_id uuid FK; location_id uuid FK

scheduled_at timestamptz; timezone text=Asia/Riyadh; note text?

status enum(proposed,accepted,rejected,cancelled,expired)

replaces_id uuid FK?; cancelled_at timestamptz?

late_cancel boolean=false; version integer

Note at most 500 characters. Attendance is not a shared meeting state. Rescheduling preserves and links the previous proposal, and all deadlines use server time.

RET04

### MeetupAttendance
A self-declaration independent of the other party.

meetup_id uuid FK; author_id uuid FK

attended boolean; declared_at timestamptz

PRIMARY KEY(meetup_id,author_id)

Accept once within 72 hours after an accepted or late-cancelled meeting. The caller cannot declare for the other party. Cancellation does not erase it, and it never enables reviews.

RET04

### Deal
Exchange completion record without processing the item price.

id uuid PK; listing_id uuid FK; conversation_id uuid FK

buyer_id,seller_id uuid FK; status enum

seller_confirmed_at,buyer_confirmed_at,completed_at timestamptz?

expires_at timestamptz; cancelled_at,voided_at timestamptz?

version integer; created_at timestamptz

States are pending, completed, cancelled, disputed and voided. Use a unique listing_id where status is not cancelled. The listing belongs to the seller and the conversation matches both parties. A dispute retains confirmations and cannot be bypassed by creating another exchange.

RET11

### Review
Immutable review tied to an eligible exchange.

id uuid PK; deal_id uuid FK; author_id,subject_id uuid FK

rating smallint CHECK(1\<=rating AND rating\<=5)

comment varchar(500)?; moderation_hidden_at timestamptz?

created_at timestamptz; UNIQUE(deal_id,author_id)

Require distinct exchange parties and the original 30 day completion window. An open dispute pauses eligibility and visibility until review. Compute the average from visible eligible reviews only and display count and one decimal place.

RET11

### Report
Member report or exchange dispute case.

id uuid PK; reporter_id uuid FK; target_type enum; target_id uuid

kind enum(report,deal_dispute); related_deal_id uuid FK?

reason enum; details text?; status enum(received,in_review,actioned,dismissed)

assigned_to uuid FK?; created_at,closed_at timestamptz?

version integer

Check target type and access before saving. A polymorphic reference is not an automatic foreign key; validate transactionally on the server. Return an existing matching report within 24 hours.

RET05

### ReportEvidence
Limited evidence snapshot for a case.

id uuid PK; report_id uuid FK; object_ref text

content_hash bytea; captured_at timestamptz

retention_until timestamptz; access_scope text

Capture only necessary content and specific messages in private storage. Audit access and prohibit navigation into unrelated conversation history.

RET05

### ModerationAction
Reasoned administrative enforcement action.

id uuid PK; case_id uuid FK?; actor_id uuid FK

subject_type enum; subject_id uuid; action enum

reason text; until timestamptz?; reversed_at timestamptz?

created_at timestamptz; version integer

Separate warnings and content hiding from suspension and ban. Retain the prior state for reversible actions; overturning one action does not remove unrelated restrictions.

RET05 RET08

### Appeal
Appeal against an administrative action.

id uuid PK; action_id uuid UNIQUE FK; appellant_id uuid FK

details text; status enum(submitted,in_review,upheld,overturned)

reviewer_id uuid FK?; decision_reason text?

created_at,closed_at timestamptz?; version integer

One appeal within 14 days, with 10-2000 characters. The original actor cannot decide it; if no independent reviewer exists, keep it pending and escalate to the operator.

RET05

### LegalHold
Narrowly scoped evidence hold.

id uuid PK; case_id uuid FK; object_ref text

reason text; retention_until timestamptz

review_due_at timestamptz; released_at timestamptz?

reviewed_by uuid FK?; version integer

Record reason, object and deadline and review every 30 days. An overdue review triggers an alert rather than automatic release.

RET05

### Block
A unilateral block with bilateral communication effects.

blocker_id,blocked_id uuid FK; created_at timestamptz

PRIMARY KEY(blocker_id,blocked_id)

CHECK(blocker_id\<\>blocked_id)

Check both directions under ordered pair locking. The caller removes their own relationship only; do not notify the blocked member.

RET06

### Notification
Private notification with a typed trusted destination.

id uuid PK; recipient_id uuid FK; event_type text

context_type enum; context_id uuid; dedupe_key text

read_at timestamptz?; created_at timestamptz

UNIQUE(recipient_id,dedupe_key)

The service derives recipient and destination; never trust a client-supplied redirect URL. Reauthorize the destination on open; retain for 90 days.

RET07

### NotificationPreference
Member locale and optional email channel groups.

user_id uuid PK/FK; offers,meetups,deals,reports boolean=true

locale enum(ar,en); version integer; updated_at timestamptz

Security and essential administrative messages are not an optional group. Preferences never change account authority.

RET06

### Contribution
Support receipt independent of item payments.

id uuid PK; user_id uuid FK?; guest_receipt_hash bytea?

amount_minor integer; currency char(3)=SAR

status enum; provider text; provider_invoice_id text?

provider_payment_id text?; live boolean

refunded_minor integer=0; expires_at,retention_until timestamptz

created_at,updated_at timestamptz

Amount 1,000-50,000 halalas. Uniqueness includes provider and environment. States distinguish creating, creating_unknown, pending, paid, creation_failed, expired, cancelled, partially_refunded and refunded. A failed payment attempt does not close a payable invoice.

RET10

### PaymentEvent
Durable inbox of payment provider events.

provider text; event_id text; live boolean

contribution_id uuid FK?; event_type text; payload_hash bytea

received_at,processed_at timestamptz?; status enum

PRIMARY KEY(provider,event_id,live)

Remove the webhook secret and unnecessary financial fields from retained payloads. The event triggers an independent provider fetch; its amount alone is not authoritative.

RET10

### IdempotencyRecord
Reservation and result of one logical request.

actor_key text; route text; request_key uuid

payload_hash bytea; state enum(processing,succeeded,failed)

result_ref text?; lease_until,expires_at timestamptz

PRIMARY KEY(actor_key,route,request_key)

General API records last 24 hours. Expiry does not remove permanent message or payment deduplication. Reauthorize any stored result before returning it.

RET08

### OutboxEvent
Event committed with its business transaction.

id bigint PK; event_type text; object_id uuid; payload_minimal jsonb

created_at,next_attempt_at timestamptz; attempts integer

lease_until,delivered_at timestamptz?; consumer_state jsonb

Track each consumer separately with deduplication. Email failure does not roll back the business operation or duplicate its message. Alert and dead-letter after ten attempts.

RET08

### AuditEvent
Security and administrative audit trail.

id uuid PK; actor_id uuid FK?; action text

target_type text; target_id uuid?; reason_ref uuid?

trace_id text; occurred_at timestamptz; metadata_minimal jsonb

Store no passwords, tokens, chat text, images or card data. Limit read access and commit sensitive actions with their audit records.

RET08

### DeletionLedger
Deletion record reapplied after restoration.

id uuid PK; subject_ref_hash bytea; object_refs jsonb

requested_at,applied_at timestamptz

retention_until timestamptz; checksum bytea

Retain only what is needed to prevent deleted data returning from backups, not a copy of the profile. Review after all relevant backup generations expire.

RET08 RET09

### RateLimitBucket
Atomic centralized quota bucket.

scope text; key_hash bytea; window_start timestamptz

count bigint; expires_at timestamptz

PRIMARY KEY(scope,key_hash,window_start)

Use short-lived hashed keys without plaintext emails or secrets. Retain a daily window through its end plus 24 hours for processing, then purge.

RET12

### PolicyAcknowledgment
The policy versions acknowledged by a member.

id uuid PK; user_id uuid FK

policy_type enum(terms,privacy); policy_version text

acknowledged_at timestamptz; locale enum(ar,en)

UNIQUE(user_id,policy_type,policy_version)

Record an actual published version and acknowledgment time, rejecting invented client versions. Acknowledgment is neither marketing consent nor blanket permission for processing outside the operator’s policy.

RET06 RET08

## Canonical enumerations

| **Enumeration** | **Values**                                                                                                    |
|-----------------|---------------------------------------------------------------------------------------------------------------|
| category        | books_study \| electronics \| room_furniture \| university_supplies \| clothing_personal \| vehicles \| other |
| condition       | new_boxed \| like_new \| good \| fair \| used                                                                 |
| listing_status  | active \| sold \| archived; moderation_hidden_at is independent                                               |
| wanted_status   | active \| found \| closed; closed_reason=owner\|expired                                                       |
| offer_status    | pending \| accepted \| rejected \| withdrawn \| expired \| cancelled                                          |
| meetup_status   | proposed \| accepted \| rejected \| cancelled \| expired                                                      |
| deal_status     | pending \| completed \| cancelled \| disputed \| voided                                                       |
| report_reason   | inappropriate_content \| fraud \| illegal_goods \| harassment \| spam \| misleading_price \| other            |
| report_status   | received \| in_review \| actioned \| dismissed                                                                |
| appeal_status   | submitted \| in_review \| upheld \| overturned                                                                |
| session_scope   | normal \| guest \| recovery \| appeal \| deletion_recover \| mfa_challenge                                    |

## Indexes and search
Start marketplace indexes with state and creation time or price plus a stable secondary identifier, and add indexes for representative category/location combinations. Preserve original text and build a search-normalized copy for Arabic elongation, diacritics, selected alef forms and Latin case. Do not alter displayed content. Test pg_trgm as approximate text matching, not semantic search. \[R29\]

Index messages by conversation_id and message_seq, and private lists by member and time. Bind cursors to filters and ordering and reject tampered or mismatched cursors. Conversation, pending-offer, review and payment uniqueness are correctness constraints, not an unlocked check-then-insert query.

# 09 Service contracts, fields and errors
These are contracts for the new product. Each operation has a method, path, access scope, inputs, result and requirement references. Shared validation and domain fields apply throughout. The developer must produce an up-to-date OpenAPI contract; this catalog is not a discovered API of the reference site.

## Shared request conventions
1\. Every browser mutation carries X-CSRF-Token and passes Origin validation, including login, signup and contributions. Authenticated provider hooks are exempt from browser sessions, not from source verification.

2\. Content, message, offer, meeting, Deal and contribution creation require Idempotency-Key. PUT and DELETE are naturally idempotent; competing edits use expected_version.

3\. Return 201 for creation, 200 for reads, updates or a recovered creation, 202 for accepted asynchronous work and 204 for completion without a body. A confirmed link may return a local 303 redirect.

4\. Successful JSON contains data and optional pagination meta. Errors contain code, message, field_errors and trace_id without SQL, stack traces or private-resource existence disclosure.

5\. Default limit is 20 and maximum 50; the explicit notification ids exception allows 100. Reject unknown security-sensitive fields and derive actor identity and roles on the server.

| **Status** | **Meaning**                                                                     |
|------------|---------------------------------------------------------------------------------|
| 400        | Invalid request structure or cursor.                                            |
| 401 / 403  | Missing session or unauthorized action; do not disclose private context.        |
| 404        | Unavailable resource using a response that does not disclose private existence. |
| 409        | State, version or idempotency payload conflict.                                 |
| 422        | Structurally valid input violating a business rule.                             |
| 429 / 503  | Quota exceeded with Retry-After, or a recoverable temporary outage.             |

## Shared input schemas

| **Schema**        | **Fields and constraints**                                                                                                                                          |
|-------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| ListingInput      | title 5-100; description 10-2000; valid category_id, condition and location_id; integer price_minor 0-5,000,000; boolean is_negotiable; 1-10 ready owned media_ids. |
| ListingPatch      | A permitted subset of listing fields; replacing images must retain 1-10. Reject client seller_id, status and created_at.                                            |
| WantedInput       | title 5-100; description 10-1000; required category_id; optional location_id; budget_minor null or integer 0-5,000,000; boolean urgent.                             |
| WantedPatch       | Permitted active-request fields without requester_id, direct status or a new creation time.                                                                         |
| ProfilePatch      | display_name 2-50; optional referenced college_id; avatar-purpose avatar_id; locale ar or en.                                                                       |
| OfferInput        | Integer amount_minor 100-5,000,000; stable client_message_id; no client-supplied buyer or seller authority.                                                         |
| MeetupInput       | Active location_id; scheduled_at in RFC3339 with explicit offset; timezone=Asia/Riyadh; note at most 500; optional replaces_id from the same conversation.          |
| ReportInput       | Allowed target_type and authorized valid target_id; one of seven reasons; details up to 2000, with 10-2000 required for Other.                                      |
| ContributionInput | Integer amount_minor 1,000-50,000; currency fixed to SAR; no financial authority from return URLs.                                                                  |

Normalize ordinary text to NFC, trim outer whitespace and count Unicode code points consistently on client and server, not UTF-16 units. Do not normalize or trim passwords; evaluate their actual characters and UTF-8 bytes. Reject harmful control and bidi-override characters while retaining normal Arabic writing and permitted line breaks.

Convert a valid SAR input string to halalas with exact decimal arithmetic after normalizing Arabic digits and the permitted decimal separator. Reject more than two decimal places rather than silently rounding floating-point values. The API accepts integers only. Numeric minima and maxima are inclusive; a time-limited token is valid only while now is earlier than expiry.

## Identity and sessions

| Operation | Access inputs and result |
|---|---|
| API001 POST<br>/api/auth/signup<br>FR01 FR57 | Guest with abuse protection<br>name, email, password, college_id?, terms_version, privacy_version, accept_terms=true, acknowledge_privacy=true<br>202 generic result; create an unconfirmed identity, record policy versions and send confirmation. |
| API002 POST<br>/api/auth/login<br>FR02 FR78 | Guest with abuse protection<br>email, password, next?<br>An eligible server session or a restricted flow; no provider tokens in the response. |
| API003 POST<br>/api/auth/logout<br>FR49 | Confirmed active member<br>current session<br>204 revoke the session and live channel and clear browser session data. |
| API004 POST<br>/api/auth/confirm<br>FR57 | Purpose-bound verification flow<br>token, flow_state<br>One-time confirmation then a local 303 redirect; no automatic market session. |
| API005 POST<br>/api/auth/resend<br>FR57 | Guest with abuse protection<br>email, purpose<br>202 without email enumeration; enforce RL03. |
| API006 POST<br>/api/auth/recovery<br>FR03 | Guest with abuse protection<br>email<br>202 and a recovery link lasting at most 60 minutes. |
| API007 POST<br>/api/auth/recovery/verify<br>FR03 FR59 | Purpose-bound verification flow<br>token, flow_state<br>A five minute recovery-only session with no market access. |
| API008 POST<br>/api/auth/reset<br>FR03 FR59 | Restricted recovery session<br>new_password<br>204 change the password and revoke all existing sessions. |
| API009 POST<br>/api/auth/reauth<br>FR59 FR77 | Confirmed active member<br>current_password, mfa_code?<br>A five minute reauthentication window; administrators also require MFA. |
| API010 POST<br>/api/auth/mfa/enroll<br>FR77 | Owner with recent reauthentication<br>factor_type=totp<br>Enroll a factor and display its setup to the owner only; verify before activation. |
| API011 POST<br>/api/auth/mfa/verify<br>FR77 | Restricted MFA challenge session<br>challenge_id, code<br>Verify the factor with the provider and recheck account state before administrative access. |
| API012 POST<br>/api/auth/mfa/recovery<br>FR77 FR78 | Restricted verified flow<br>support_case_ref<br>202 a manually verified administrative recovery request; no automatic MFA bypass. |
| API013 GET<br>/api/csrf<br>FR74 | Guest or member<br>none<br>A no-store synchronizer token bound to the member or guest session. |
| API014 POST<br>/api/auth/email-hook<br>FR57 FR59 | Authenticated provider without browser session<br>signed provider event<br>Verify source, timestamp and replay protection; persist a flow and send the application link. |

## Profiles and accounts

| Operation | Access inputs and result |
|---|---|
| API015 GET<br>/api/me<br>FR49 | Confirmed active member<br>none<br>Private account fields and effective capabilities, without provider secrets. |
| API016 PATCH<br>/api/profile/me<br>FR49 FR61 | Confirmed active member<br>display_name?, college_id?, avatar_id?, locale?, expected_version<br>200 permitted fields or 409 conflict; the avatar must be an eligible avatar-purpose asset. |
| API017 GET<br>/api/profile/{id}<br>FR14 | Public<br>id<br>Public profile, join month and visible rating statistics; no private email. |
| API018 GET<br>/api/profile/{id}/listings<br>FR14 | Public<br>cursor, limit, status=active\|sold<br>Paginated public non-hidden listings with deterministic ordering. |
| API019 GET<br>/api/profile/{id}/reviews<br>FR14 FR47 | Public<br>cursor, limit<br>Visible eligible reviews with correctly derived count and average. |
| API020 POST<br>/api/profile/email-change<br>FR59 | Owner with recent reauthentication<br>new_email<br>202 require both addresses to confirm; keep the old address until completion. |
| API021 POST<br>/api/profile/email-change/confirm<br>FR59 | Purpose-bound verification flow<br>token, flow_state<br>Record the relevant confirmation; replace the email and revoke sessions after both succeed. |
| API022 POST<br>/api/profile/password-change<br>FR59 | Owner with recent reauthentication<br>current_password, new_password<br>204 verified password change and session revocation. |
| API023 POST<br>/api/profile/university-verification<br>FR58 | Confirmed active member<br>university_email<br>202 for an approved domain under RL03; do not replace login email. |
| API024 POST<br>/api/profile/university-confirm<br>FR58 | Purpose-bound verification flow<br>token, flow_state<br>204 record university mailbox ownership for one year. |
| API025 DELETE<br>/api/profile/university-verification<br>FR58 | Confirmed active member<br>expected_version<br>204 remove the badge and retain only policy-required proof records. |
| API026 POST<br>/api/profile/deletion<br>FR72 | Owner with recent reauthentication<br>acknowledge=true<br>202 start the recovery period, revoke sessions and hide owned content. |
| API027 POST<br>/api/profile/deletion-recovery/request<br>FR72 | Guest with abuse protection<br>email<br>202 generic result and a purpose-limited verification flow. |
| API028 POST<br>/api/profile/deletion-recovery/confirm<br>FR72 | Purpose-bound verification flow<br>token, flow_state<br>Recover within 30 days while preserving suspension or ban. |
| API029 PATCH<br>/api/me/preferences<br>FR05 FR68 | Confirmed active member<br>locale?, email_groups?, expected_version<br>200; security email and authorization cannot be disabled through preferences. |

## Market wanted and media

| Operation | Access inputs and result |
|---|---|
| API030 GET<br>/api/catalog<br>FR08 FR20 FR55 | Public<br>locale<br>Active categories, colleges and locations with stable keys. |
| API031 GET<br>/api/listings<br>FR06 FR07 FR08 FR09 FR10 FR11 FR12 | Public<br>q?, category?, condition?, location?, sort?, cursor?, limit?<br>Public listings; default 20 and maximum 50; intersect filters. |
| API032 GET<br>/api/listings/{id}<br>FR13 | Public<br>id<br>200 available listing with its current state, or a generic 404. |
| API033 GET<br>/api/me/listings<br>FR23 FR24 | Confirmed active member<br>status?, cursor?, limit?<br>Owned listings across status tabs with permitted restriction information. |
| API034 POST<br>/api/listings<br>FR16 FR17 FR18 FR19 FR20 FR21 FR22 | Confirmed active member<br>ListingInput, media_ids[1..10]<br>201 one idempotently created listing with ready actor-owned images. |
| API035 PATCH<br>/api/listings/{id}<br>FR23 | Eligible owner<br>ListingPatch, expected_version<br>200 update an eligible active listing only; preserve creation time. |
| API036 POST<br>/api/listings/{id}/transition<br>FR24 | Eligible owner<br>action=mark_sold\|archive\|restore, expected_version<br>New state or 409; never restore sold or administratively hidden content through owner action. |
| API037 POST<br>/api/uploads/authorize<br>FR17 FR61 FR69 | Confirmed active member<br>purpose, bytes, mime, width, height, context_id?<br>Five minute quarantine upload authorization; chat requires its conversation context. |
| API038 POST<br>/api/uploads/{id}/complete<br>FR61 | Eligible owner<br>checksum, expected_size<br>202 begin real validation; client claims do not make the image ready. |
| API039 GET<br>/api/uploads/{id}<br>FR80 | Upload owner or authorized context party<br>id<br>Upload and processing status with a safe rejection reason. |
| API040 DELETE<br>/api/uploads/{id}<br>FR61 FR73 | Eligible owner<br>id<br>204 remove an unattached temporary upload only; not a historical attachment. |
| API041 POST<br>/api/media/{id}/access<br>FR69 | Eligible context participant<br>conversation_id<br>A private download link lasting at most 60 seconds after reauthorization. |
| API042 GET<br>/api/wanted<br>FR25 | Public<br>q?, category?, location?, urgent?, cursor?, limit?<br>Active wanted requests; distinguish null budget from zero. |
| API043 GET<br>/api/wanted/{id}<br>FR25 | Public<br>id<br>200 available request and state, or a generic 404; exclude hidden content. |
| API044 GET<br>/api/me/wanted<br>FR27 | Confirmed active member<br>status?, cursor?, limit?<br>The owner’s active, found and closed requests. |
| API045 POST<br>/api/wanted<br>FR26 | Confirmed active member<br>WantedInput<br>201 one request with a 60 day initial expiry. |
| API046 PATCH<br>/api/wanted/{id}<br>FR27 | Eligible owner<br>WantedPatch, expected_version<br>200 update an active request without resetting creation time. |
| API047 POST<br>/api/wanted/{id}/transition<br>FR27 | Eligible owner<br>action=found\|close\|reopen, expected_version<br>Apply the single-reopen window and absolute 90 day lifetime cap. |
| API048 GET<br>/api/me/favorites<br>FR15 | Confirmed active member<br>cursor?, limit?<br>Private favorites with an unavailable placeholder rather than hidden content disclosure. |
| API049 PUT<br>/api/favorites/{listing_id}<br>FR15 | Confirmed active member<br>none<br>204 idempotent save. |
| API050 DELETE<br>/api/favorites/{listing_id}<br>FR15 | Confirmed active member<br>none<br>204 idempotent removal. |

## Conversation offers and meetings

| Operation | Access inputs and result |
|---|---|
| API051 POST<br>/api/conversations<br>FR29 FR62 | Confirmed active member<br>listing_id XOR wanted_id<br>201 created or 200 existing; derive the other participant from context ownership. |
| API052 GET<br>/api/conversations<br>FR30 | Confirmed active member<br>q?, cursor?, limit?<br>Private summaries with separate conversation and unread incoming counts. |
| API053 GET<br>/api/conversations/{id}<br>FR28 FR32 FR42 | Eligible context participant<br>id<br>Stable context and current UI capabilities, without trusting client-supplied permissions. |
| API054 GET<br>/api/conversations/{id}/messages<br>FR31 FR64 | Eligible context participant<br>after_seq XOR before_seq?, limit<=50<br>Ordered messages and committed last_seq; no third-party access. |
| API055 POST<br>/api/conversations/{id}/messages<br>FR31 FR41 FR69 | Eligible context participant<br>client_message_id, body?, media_ids[0..3]<br>201 or 200 for retry; require text or images and commit message and event together. |
| API056 POST<br>/api/conversations/{id}/read<br>FR64 | Eligible context participant<br>through_seq, mark_all=false<br>An authorized monotonic cursor no later than the committed last message. |
| API057 POST<br>/api/conversations/{id}/offers<br>FR33 FR34 | Contextual buyer<br>amount_minor, client_message_id<br>201 a 100-5,000,000 halala offer lasting 72 hours. |
| API058 PATCH<br>/api/offers/{id}<br>FR35 FR65 | Recipient decides or sender withdraws<br>action=accept\|reject\|withdraw, expected_version<br>The recipient decides and sender withdraws; 409 on conflict. |
| API059 POST<br>/api/conversations/{id}/meetups<br>FR37 FR38 | Eligible context participant<br>location_id, scheduled_at, timezone, note?, replaces_id?<br>201 a proposal 30 minutes to 30 days ahead. |
| API060 PATCH<br>/api/meetups/{id}<br>FR39 FR65 | Meeting party as permitted by action<br>action=accept\|reject\|cancel, expected_version<br>An authorized transition retaining cancellation time and late flag. |
| API061 POST<br>/api/meetups/{id}/attendance<br>FR39 | Meeting party as permitted by action<br>attended:boolean<br>201 one self-attendance declaration within 72 hours after the time; not delivery proof. |
| API062 PUT<br>/api/blocks/{user_id}<br>FR44 FR79 | Confirmed active member<br>known authorized relationship<br>204 persist a bilateral-effect block and required cancellations under shared locks. |
| API063 DELETE<br>/api/blocks/{user_id}<br>FR63 | Confirmed active member<br>none<br>204 remove the caller’s block only. |
| API064 GET<br>/api/me/blocks<br>FR63 | Confirmed active member<br>cursor?, limit?<br>The caller’s private block list only. |
| API065 WS<br>/realtime<br>FR40 FR41 | Confirmed active member<br>subscribe(context), resume_seq<br>Authenticate before upgrade and reauthorize delivery; REST recovers gaps. |

## Deals safety and notifications

| Operation | Access inputs and result |
|---|---|
| API066 POST<br>/api/deals<br>FR66 | Listing seller<br>conversation_id, listing_id<br>201 Deal and seller confirmation; a wanted context also requires that seller’s listing. |
| API067 GET<br>/api/me/deals<br>FR66 FR47 | Confirmed active member<br>status?, cursor?, limit?<br>The member’s Deals and current confirmation and review capabilities. |
| API068 GET<br>/api/deals/{id}<br>FR66 | Named Deal party<br>id<br>Private Deal details and both confirmation timestamps. |
| API069 POST<br>/api/deals/{id}/confirm<br>FR66 | Named Deal party<br>expected_version<br>Record the caller’s confirmation only; complete once both are present. |
| API070 POST<br>/api/deals/{id}/cancel<br>FR66 | Named Deal party<br>reason, expected_version<br>Cancel pending only; never reactivate a sold listing. |
| API071 POST<br>/api/deals/{id}/reviews<br>FR47 | Named Deal party<br>rating, comment?<br>201 one eligible review per party within 30 days. |
| API072 POST<br>/api/deals/{id}/disputes<br>FR66 FR67 | Named Deal party<br>reason, details<br>202 a post-completion dispute case; retain history and pause review eligibility during review. |
| API073 POST<br>/api/reports<br>FR43 FR45 | Confirmed active member<br>target_type, target_id, reason, details?<br>202 a private reference; reuse the matching report within 24 hours. |
| API074 GET<br>/api/me/reports<br>FR45 FR67 | Confirmed active member<br>status?, cursor?, limit?<br>Owned report tracking without evidence belonging to other parties or reviewer identity. |
| API075 GET<br>/api/me/reports/{id}<br>FR45 | Eligible owner<br>id<br>Permitted tracking status and outcome only. |
| API076 POST<br>/api/appeals<br>FR67 FR78 | Restricted appeal session<br>action_id, details<br>202 one appeal within 14 days through a restricted scope. |
| API077 GET<br>/api/me/appeals<br>FR67 | Restricted appeal session<br>cursor?, limit?<br>The restricted session owner’s appeals only. |
| API078 GET<br>/api/notifications<br>FR48 | Confirmed active member<br>cursor?, limit?<br>The recipient’s notifications within their 90 day retention period. |
| API079 PATCH<br>/api/notifications<br>FR48 | Confirmed active member<br>ids[1..100], read=true<br>Mark only the owner’s notifications read; never disclose another recipient. |

## Contributions and verification

| Operation | Access inputs and result |
|---|---|
| API080 POST<br>/api/contributions/checkout<br>FR50 FR51 | Guest or member<br>amount_minor, currency=SAR<br>201 identifier and hosted URL; issue a 24 hour HttpOnly guest receipt cookie. |
| API081 GET<br>/api/contributions/{id}/status<br>FR52 FR53 | Contribution owner or valid receipt cookie<br>id; receipt via cookie<br>Limited status, amount and currency with no-store; no card data or secret in the URL. |
| API082 POST<br>/api/payments/moyasar/webhook<br>FR53 FR75 | Authenticated provider without browser session<br>id, type, live, secret_token, data<br>202 after durable inbox storage; process asynchronously and verify independently with the provider. |

## Administration and operations

| Operation | Access inputs and result |
|---|---|
| API083 GET<br>/api/admin/reports<br>FR54 FR67 | Authorized case reviewer with MFA<br>status?, assigned?, cursor?, limit?<br>Authorized cases only; no general member-conversation browser. |
| API084 GET<br>/api/admin/reports/{id}<br>FR54 FR67 | Authorized case reviewer with MFA<br>id<br>Case-scoped evidence with audited access. |
| API085 POST<br>/api/admin/reports/{id}/assign<br>FR67 | Operator with MFA<br>reviewer_id, expected_version<br>Assign an eligible reviewer without a conflict of interest. |
| API086 POST<br>/api/admin/reports/{id}/decision<br>FR54 FR67 | Case reviewer with MFA and recent reauthentication<br>decision, reason, expected_version<br>Commit the authorized action, decision, audit and notification atomically. |
| API087 GET<br>/api/admin/accounts<br>FR54 FR77 | Operator with MFA<br>q?, status?, cursor?, limit?<br>Restricted administrative search; no bulk email or chat export. |
| API088 POST<br>/api/admin/accounts/{id}/action<br>FR77 FR78 | Authorized administrator with MFA and recent reauthentication<br>action, reason, expected_version, until?<br>Authorized warning or suspension; only operators may ban or unban. |
| API089 GET<br>/api/admin/listings<br>FR54 | Authorized content moderator with MFA<br>status?, moderation?, cursor?, limit?<br>Review public content and hiding states without unrestricted message access. |
| API090 POST<br>/api/admin/listings/{id}/moderation<br>FR54 | Authorized administrator with MFA and recent reauthentication<br>action=hide\|unhide, reason, expected_version<br>Hide or unhide independently while preserving active or sold status. |
| API091 GET<br>/api/admin/appeals<br>FR67 | Operator with MFA<br>status?, cursor?, limit?<br>An appropriately restricted appeals queue. |
| API092 POST<br>/api/admin/appeals/{id}/decision<br>FR67 | Independent authorized reviewer with MFA and recent reauthentication<br>decision, reason, expected_version<br>Reasoned uphold or overturn with its effect; the original actor cannot review their own action. |
| API093 POST<br>/api/admin/deals/{id}/dispute-decision<br>FR66 FR67 | Independent authorized reviewer with MFA and recent reauthentication<br>decision=restore_completed\|void, reason, expected_version<br>Resolve review eligibility while preserving confirmations; do not execute an external item-payment refund. |
| API094 GET<br>/api/admin/catalog/{kind}<br>FR55 | Catalog manager or operator with MFA<br>kind=category\|college\|location<br>Translated references, their state and source. |
| API095 POST<br>/api/admin/catalog/{kind}<br>FR55 | Catalog manager or operator with MFA<br>key, label_ar, label_en, kind?, display_order<br>201 a stable identifier with duplicate checks; no invented facility names. |
| API096 PATCH<br>/api/admin/catalog/{kind}/{id}<br>FR55 | Catalog manager or operator with MFA<br>labels?, is_active?, expected_version<br>Update or deactivate without deleting a used reference. |
| API097 GET<br>/api/admin/domains<br>FR77 | Operator with MFA<br>cursor?, limit?<br>University domains and their verification sources. |
| API098 POST<br>/api/admin/domains<br>FR77 | Operator with MFA and recent reauthentication<br>domain, evidence_ref<br>201 an operator-validated domain; reject public email domains. |
| API099 PATCH<br>/api/admin/domains/{id}<br>FR77 | Operator with MFA and recent reauthentication<br>is_active, reason, expected_version<br>Domain deactivation revokes or suspends dependent verification badges. |
| API100 GET<br>/api/admin/roles<br>FR77 | Operator with MFA<br>user_id<br>Current role grants and their history without identity secrets. |
| API101 PUT<br>/api/admin/roles/{user_id}/{role}<br>FR77 | Operator with MFA and recent reauthentication<br>reason<br>Audited grant; protect the last active operator and prohibit self-escalation without an approved process. |
| API102 DELETE<br>/api/admin/roles/{user_id}/{role}<br>FR77 | Operator with MFA and recent reauthentication<br>reason<br>Audited revocation and invalidation of stale privileged sessions. |
| API103 GET<br>/api/admin/metrics<br>FR54 | Operator or authorized metrics role with MFA<br>from, to<br>Aggregate counts without message text or email addresses. |
| API104 POST<br>/api/admin/holds/{id}/review<br>FR73 | Operator with MFA and recent reauthentication<br>extend_until? XOR release, reason<br>Review a specific hold with audit; no indefinite extension. |
| API105 GET<br>/healthz<br>FR76 | Non-disclosing health probe<br>none<br>Process liveness only, without secrets or public dependency details. |
| API106 GET<br>/readyz<br>FR76 | Authorized internal probe<br>none<br>Readiness of required dependencies and functions, without member data. |

## Submission and conflict examples
POST /api/conversations/{id}/messages

Idempotency-Key: \<uuid\>

X-CSRF-Token: \<session-bound-token\>

{

"client_message_id": "\<uuid\>",

"body": "Is the item available?",

"media_ids": \[\]

}

201 {"data":{"id":"\<uuid\>","message_seq":42,"status":"saved"}}

PATCH /api/offers/{id}

Idempotency-Key: \<uuid\>

{"action":"accept","expected_version":3}

200 {"data":{"status":"accepted","version":4}}

409 {"code":"STATE_CONFLICT","trace_id":"\<opaque\>"}

Reserve an idempotency key with actor, route and normalized payload hash for 24 hours. The same payload returns the stored result after reauthorization; a changed payload returns 409. An operation still processing returns 202 with retry_after, using a bounded processing lease. Permanent message and payment uniqueness does not expire with the request-key record.

# 10 Security, authorization and payment policies
## SEC01 Sessions and trust boundaries
The UI calls a same-origin BFF, which contacts the identity provider. Generate a random 256-bit session identifier and store its hash plus encrypted provider tokens server-side, using a key outside the database. Use \_\_Host-sj_session with Secure, HttpOnly, SameSite=Lax, Path=/ and no Domain. Do not expose a JWT, refresh token or service key to browser JavaScript or local/session storage. \[R25\]

| **Session**       | **Absolute lifetime**             | **Idle timeout**         | **Additional control**                                             |
|-------------------|-----------------------------------|--------------------------|--------------------------------------------------------------------|
| Member            | 30 days                           | 7 days                   | Five minute reauthentication window for sensitive work.            |
| Administration    | 8 hours                           | 30 minutes               | Mandatory MFA and recent reauthentication for sensitive decisions. |
| Password recovery | 5 minutes after link verification | Within the same lifetime | Password change only; no market or chat access.                    |
| Guest receipt     | 24 hours                          | No account authority     | Separate cookie authorizing limited receipt status only.           |

Rotate the session identifier after login, privilege elevation and every 24 hours, revoking the previous identifier. Revoke sessions on logout, password change, completed email change, account restriction and deletion request. Check current token_version and account state rather than stale claims. Serialize refresh-token rotation so concurrent requests cannot overwrite newer credentials.

## SEC02 Authorization roles and database access
Deny by default. The BFF uses a dedicated SQL role that neither owns tables nor has BYPASSRLS, setting verified identity through SET LOCAL within each transaction after application-session validation. Never accept sub or role from the request, and do not leak context through pooled connections. Prohibit direct anon/authenticated writes or RPC paths that bypass service rules or quotas. \[R02, R03\]

| **Role**                | **Permitted work**                                                      | **Boundary**                                                             |
|-------------------------|-------------------------------------------------------------------------|--------------------------------------------------------------------------|
| Visitor                 | Public reading, signup, recovery and contribution.                      | No private favorites, posting or chat.                                   |
| Confirmed active member | Owned content, participant conversations and governed account rights.   | No client role, ownership or reputation authority.                       |
| Unconfirmed account     | Browsing, confirmation and resend.                                      | No market writes or uploads before confirmation.                         |
| Restricted account      | Verified limited appeals and account-rights flows.                      | No ordinary private access or new live delivery.                         |
| Moderator               | Authorized case evidence, warnings, hiding and 7 or 30 day suspension.  | No permanent ban, role grants or unrestricted chat access.               |
| Catalog manager         | Categories, colleges, locations and their labels.                       | No university-domain approval, roles or payment data.                    |
| Operator                | Roles, domains, permanent restrictions, operations and case assignment. | MFA and audit; no appeal decision on the operator’s own original action. |
| Worker                  | Specific media, retention, reconciliation and notification jobs.        | Separate least-privilege role, not used for ordinary member requests.    |

Provision the first operator through a project-owner-controlled one-time bootstrap, record the grant and close that route afterward. Do not commit default admin passwords in seeds. Protect the last active operator from deletion or revocation without an approved replacement. Recover a lost second factor through manual verification, not a bypass button.

## SEC03 Passwords and verification links
Passwords are 15-64 characters and at most 72 UTF-8 bytes with bcrypt. Reject longer values clearly without truncation, so Arabic or emoji may reach the byte limit before 64 characters. Allow paste and password managers without mandatory character classes or unjustified periodic resets. This product policy is informed by authentication guidance and does not claim literal NIST conformance. \[R10, R11, R24\]

Use an authenticated Send Email Hook to send a random application link through Resend, keeping the provider token encrypted in AuthFlow. Provider tokens never reach email or the browser. GET displays a confirmation page without consumption; a protected POST consumes once, preventing mail scanners from activating an account just by fetching. Exclude external resources, use no-referrer and no-store, and safely remove the link token from the address after display. \[R26\]

| **Purpose**         | **Lifetime**                  | **Effect**                                             |
|---------------------|-------------------------------|--------------------------------------------------------|
| Signup confirmation | 24 hours                      | Confirm identity, followed by separate ordinary login. |
| Password recovery   | 60 minutes                    | Five minute password-reset-only session.               |
| Email change        | 24 hours for each destination | Keep the old email until both addresses confirm.       |
| University mailbox  | 24 hours                      | Separate application proof lasting one year.           |

Supabase email-link expiry is shared across authentication flows. To honor the 24 hour confirmation decision, configure otp_expiry=86400 while the BFF enforces the shorter 60 minute recovery application token without exposing the provider token. This is a deliberate product setting; the documented provider default is one hour. Verify that no direct recovery path bypasses application protection. \[R27\]

Enable Secure Email Change and require both addresses. Bind each AuthFlow message to the correct destination: provider field names are counterintuitive, with token_hash_new for the current address and token_hash for the new one when both pairs are issued. One confirmation does not complete replacement. A lost-mailbox recovery must not automatically bypass this rule. \[R26\]

If connectivity fails after provider verification but before committing the flow state, inspect authoritative identity state server-side and reconcile consumption or offer a safe resend. Do not consume twice or turn recovery into a market session. Validate Auth Hook signatures, timing and replay protection using the provider’s official mechanism and retain native Auth rate limits.

## SEC04 CORS
Default to same-origin without public CORS. If another trusted origin is required, allowlist exact scheme, host and port per environment. Never reflect arbitrary Origin or allow null or wildcard with credentials; constrain methods and headers and set Vary: Origin. Configure storage upload CORS for trusted UI origins too. Browser policy is not authorization for non-browser clients. \[R08\]

## SEC05 CSRF
Every browser POST, PUT, PATCH and DELETE carries a random synchronizer token bound to a member or guest session. Validate exact Origin and Fetch Metadata when available; SameSite alone is insufficient. GET never accepts, publishes, deletes or consumes a link. Payment webhooks and Auth Hooks use independent provider authentication rather than browser sessions or CSRF and are not rejected merely for missing Origin. \[R07\]

## SEC06 Content connections and secrets
Render member input as encoded text without executable HTML. Safe linkification must not fetch target pages server-side. Use parameterized queries and allowlisted fields. Reject member-supplied upload destinations or external image sources that could cause SSRF. Configure nonce-based CSP, frame-ancestors, nosniff and an appropriate referrer policy, limiting each script, image and connection source.

Store environment secrets outside the repository with an owner and rotation plan. Identity-admin credentials must not write member content and media workers need no unrelated financial access. Never log full auth links, JWTs, webhook secrets, OTPs or card data. Log trace ID, safe error code, duration and route template. Check source, builds, browser and logs for secret leakage.

## SEC07 Rate limiting
These initial product limits must be reviewed after workload testing. Enforce atomic centralized counters in Postgres or Redis, not per-process memory. Derive IP from a trusted proxy chain, not arbitrary X-Forwarded-For. Separate member limits from shared-network protection so one user does not lock the campus network.

| ID and operation | Key and limit | Behavior |
|---|---|---|
| RL01<br>Login failures | Account or email hash: 5 failures / 15 min; shared IP: 200 / 15 min | Progressive delay up to 15 minutes; no permanent automatic account lock or email enumeration. |
| RL02<br>Signup | Guest session: 5 / hour; shared IP: 50 / hour | Challenge suspicious activity, then 429; account for campus NAT. |
| RL03<br>Email confirmation and recovery | Email or account: 60 second cooldown, 3 / hour and 10 / day | Generic response; align provider-native limits and both email-change destinations. |
| RL04<br>Public search | Guest session: 120 / minute; shared IP: 1200 / minute | 429 and Retry-After; do not break already rendered public content. |
| RL05<br>Publish listing or request | Member: 5 / hour and 20 / day combined | At most 200 active listings and 20 active wanted requests per member. |
| RL06<br>New conversations | Member: 20 / hour and 50 / day with new parties | Returning an existing conversation does not consume a new-conversation count. |
| RL07<br>Messages | Member: 30 / minute and 2000 / day; conversation: 10 / minute | Count one logical saved message once after deduplication. |
| RL08<br>Offers and meetings | Conversation: 10 / hour; member: 60 / hour | One pending offer and at most four future non-cancelled meetings per conversation. |
| RL09<br>Image authorization | Member: 60 files / hour and 200 MiB / day before processing | Reserve quota before authorization; verify actual bytes and prevent reuse or overwrite. |
| RL10<br>Reports and appeals | Member: 10 reports / day; one appeal per action within 14 days | Reuse matching reports within 24 hours; keep a verified support route available. |
| RL11<br>Contribution creation | Member or guest: 3 / 10 min and 10 / day; shared IP: 300 / 10 min | Apply abuse controls without arbitrarily locking a shared campus network. |
| RL12<br>Administration and WebSocket | Admin session: 60 mutations / minute; member: 5 live connections | Use central counters; authenticate and validate origin before connection upgrade. |
| RL13<br>Authenticated payment events | Provider and environment: 1200 / minute; event at most 256 KiB | Durably queue then return 202; temporary overload returns 503, with separate limits for invalid traffic. |
| RL14<br>MFA challenge | 5 failures per 5 minutes per session and factor; 10 new challenges per account per hour. | Invalidate an exhausted challenge and require a new one within quota; keep identity-provider limits enabled. |

Return 429 with Retry-After and a clear message on quota exhaustion. If a sensitive write counter is unavailable, return 503 rather than allowing unlimited writes. Count a successful logical operation once after deduplication and track failures separately. Reserve upload bytes before authorization, verify actual bytes and release unused reservations after an unused grant expires.

This version uses fixed UTC-aligned windows for each minute, hour, day or stated interval, with atomic increment and expiry. Retry-After is the remaining seconds to the window end; the 60 second email cooldown is independent. Test adjacent-window boundaries and review values after workload measurement. Changing the algorithm or period requires updating the policy and tests.

## SEC08 Images and chat attachments
![Figure 23 Private quarantine processing, context binding and publication of authorized derivatives only.](spec-assets/media/image27.png)

Figure 23 Private quarantine processing, context binding and publication of authorized derivatives only.

Generate an unpredictable object path and a five minute create-only grant without overwrite. Purpose is listing, chat or avatar; derive avatar context from the member and authorize chat membership before upload. Check real bytes, decoding, size, dimensions and frame count. R1 rejects SVG, GIF, HEIC and animated images with a clear format error.

5 MiB is 5,242,880 bytes and the input limit is 24 megapixels. Apply orientation before stripping EXIF and other metadata and re-encoding. Keep a processed private master and 150, 600 and 1200 pixel variants without upscaling. WebP quality 80 is an initial measured setting, not a size guarantee. Start at two concurrent images and a 15 second processing timeout, tuning after measurement without weakening safety bounds.

Raw inputs are never public. Publish listing derivatives only after publication commits; chat images always remain private with reauthorized links lasting at most 60 seconds. On archiving or hiding, stop rendering immediately, remove public copies and request CDN purge, with a planned 60 minute maximum cache. Do not promise recall of already-downloaded copies. An authorized restore regenerates public variants from the private processed master. \[R12\]

## SEC09 Reports moderation and appeals

| **Key**               | **Meaning**                                       |
|-----------------------|---------------------------------------------------|
| inappropriate_content | Inappropriate content.                            |
| fraud                 | Fraud or scam.                                    |
| illegal_goods         | Illegal, stolen or counterfeit goods.             |
| harassment            | Harassment or abuse.                              |
| spam                  | Spam or duplicated advertising.                   |
| misleading_price      | Misleading price.                                 |
| other                 | Other, requiring a 10-2000 character explanation. |

Targets may be listing, wanted, conversation, message, review or user, provided the reporter can access the existing target. Capture only necessary message evidence, prohibit self-reporting and protect reporter identity. The initial triage target is 48 elapsed hours from filing, with an assigned reviewer, backup and escalation route; it is not a promise to resolve every case within that time.

Filing does not automatically punish or notify the accused. Notify an affected member after an actual action, with a concise reason and 14 day appeal. The original decision maker cannot review their own appeal; absent an independent reviewer, keep it pending with escalation. An overturn records the reversed action and reason without removing unrelated restrictions.

## SEC10 Contributions and financial verification
![Figure 24 Create a server-controlled contribution and redirect to hosted checkout without card data entering the application.](spec-assets/media/image28.png)

Figure 24 Create a server-controlled contribution and redirect to hosted checkout without card data entering the application.

Create an SAR invoice for 1,000-50,000 halalas with expired_at set to a full UTC timestamp 30 minutes ahead. Derive success_url and back_url from trusted configuration, not user input. Use HTTPS on the allowlisted provider host, regardless of HTTP documentation examples. Issue a separate 24 hour HttpOnly guest receipt cookie; do not put its secret in a URL or analytics. \[R14, R18\]

If creation times out with an unknown outcome, retain creating_unknown and stop blind retries. Reconcile the reference through provider facilities or manual review; do not assume the Payment API’s given_id supplies Invoice idempotency. A failed return or back action does not prove no collection occurred. \[R17\]

![Figure 25 Durably receive an event, then independently retrieve payment and invoice state before committing its effect.](spec-assets/media/image29.png)

Figure 25 Durably receive an event, then independently retrieve payment and invoice state before committing its effect.

Set up and verify the webhook through the provider before live use. Validate secret_token, environment and size, remove secrets from retained data, durably store the unique event and return 202. The worker retrieves Payment and Invoice using server credentials and matches amount, currency, invoice and environment before paid. Do not use Stripe-Signature with Moyasar. \[R15, R16, R28\]

An invoice may contain multiple payment attempts; one failed attempt does not finally fail a still-payable invoice. An old event cannot regress paid. Derive partial or full refunds from current provider state and its refunded amount, not an event label alone. Any actual support refund uses operator-authorized provider tools; the application does not refund member item payments.

## SEC11 Notifications channels and preferences

| **Event**                                               | **In-app recipient**                    | **Default email** |
|---------------------------------------------------------|-----------------------------------------|-------------------|
| New message                                             | Recipient only                          | No                |
| Offer, decision, withdrawal or expiry                   | Affected party                          | Optional          |
| Meeting proposal, acceptance, rejection or cancellation | Other participant                       | Optional          |
| Accepted meeting reminder two hours before              | Both if the reminder time is applicable | Optional          |
| Deal confirmation, completion or dispute                | Affected party                          | Optional          |
| New review                                              | Review subject                          | Off by default    |
| Report receipt and permitted outcome                    | Reporter only                           | Optional          |
| Administrative action and appeal outcome                | Affected member                         | Required          |
| Credential changes and account deletion                 | Account owner                           | Required          |
| Block or unblock                                        | UI confirmation to blocker only         | No                |
| Report filing before a decision                         | No notification to subject              | No                |
| Request matching and Web Push                           | Later opt-in feature                    | Outside R1        |

Optional email groups are offers, meetups, deals and reports, initially enabled and individually configurable. Account security and essential administrative email remain required; never include private message text. Send the two hour reminder once only if acceptance occurred before that point; do not add a duplicate immediate reminder for a nearby meeting.

The server derives recipient, destination and dedupe_key and avoids unnecessary self-notifications. Reauthorize the destination on open; email failure never repeats the business operation. Do not notify a member merely because they were blocked or reported; retain case and reporter confidentiality.

# 11 Quality, performance and capacity targets
These are new-product acceptance targets, not measured reference-site results or contractual provider guarantees. Record build, server specification, region, network, dataset, request mix and measurement date for each test. Do not compare a laboratory result with mobile-network experience without describing the difference.

| ID and objective | Acceptance target | Tests |
|---|---|---|
| NFR01<br>Responsive layout | At 360, 768 and 1440 CSS pixels, primary forms reflow without horizontal page scrolling. | TC24 TC68 |
| NFR02<br>Language and direction | Translate all fixed R1 text; preserve member language and isolate numbers, URLs and identifiers. | TC24 TC61 TC68 TC81 |
| NFR03<br>Accessibility | Target WCAG 2.2 AA with keyboard navigation, labels, visible focus, contrast and 200% zoom. | TC24 TC68 |
| NFR04<br>API performance | At 100 concurrent users and the specified dataset, p95 is at most 1 second and 5xx below 1%. | TC30 |
| NFR05<br>Live delivery | At the same controlled baseline, p95 from commit to displayed event is at most 2 seconds. | TC30 TC42 |
| NFR06<br>Scaling measurements | Measure 500 concurrent users for scaling and 1000 for stress; neither is an untested production guarantee. | TC30 |
| NFR07<br>Availability objective | Internal monthly target 99.5%, equivalent to 216 minutes of downtime in 30 days; not a provider SLA. | TC72 |
| NFR08<br>Recovery objectives | Test database and media together against RPO at most 24 hours and RTO at most 4 hours. | TC60 |
| NFR09<br>Idempotency | Retries and repeated events must not duplicate listings, messages, decisions or contribution effects. | TC09 TC13 TC15 TC23 |
| NFR10<br>Payload bounds | JSON at most 128 KiB; payment event at most 256 KiB; enforce the actual image byte and dimension limits. | TC07 TC32 TC66 |
| NFR11<br>Identity secrets | No provider token or service key reaches the browser; protected BFF sessions are revoked on the defined events. | TC27 TC56 TC65 |
| NFR12<br>Authorization | Check role, ownership, relationship and state for every private read, write, download and live delivery. | TC12 TC17 TC57 TC67 |
| NFR13<br>Diagnostics | Return trace_id and safe errors; logs exclude chat text, passwords, tokens, webhook secrets and card data. | TC31 TC53 TC65 |
| NFR14<br>Pagination | Use an authorized cursor bound to filters and order, default 20 and maximum 50, with a stable secondary identifier. | TC29 |
| NFR15<br>Data maintenance | Run retention jobs daily and use reference data rather than duplicated interface literals. | TC61 TC71 TC83 |
| NFR16<br>Client compatibility | Test the latest two stable Chrome, Firefox, Edge and Safari releases at acceptance, plus Android and iPhone. | TC68 |
| NFR17<br>Deployment consistency | Promote the same build artifact from staging; test an expand migration and a compatible rollback. | TC69 |
| NFR18<br>Operational privacy | Limit evidence access by case and purpose; retention is bounded and holds are reasoned and reviewed monthly. | TC48 TC57 TC59 TC71 |

## Reproducible workload
Use synthetic data without personal information: 10,000 listings, 5,000 requests, 50,000 conversations and one million messages. After five minutes of warmup, run 30 minutes with 100 concurrent users: 70% browse/search, 20% conversation reads, 8% messages and 2% publish/update. Measure p95, 5xx, event delivery, CPU, memory, connection pool and worker lag.

Baseline R1 acceptance is at 100 concurrent users under NFR04 and NFR05. Follow with 500-user scaling and 1000-user stress measurements to identify limits. Do not advertise higher capacity without recorded evidence and revised resources. The internal 99.5% availability objective equals 216 minutes in a 30 day month and is not automatically a contractual SLA.

## Storage and transfer assumptions

| **Assumption**                            | **Calculation**                           | **Approximate result** |
|-------------------------------------------|-------------------------------------------|------------------------|
| 1000 new monthly listings with 4 images   | 4000 × 0.98 MiB                           | 3.83 GiB/month         |
| 5000 monthly chat images                  | 5000 × 0.5 MiB                            | 2.44 GiB/month         |
| 2000 initial avatars                      | 2000 × 0.1 MiB                            | 0.20 GiB               |
| 12 months of media without purge          | (3.83 + 2.44) × 12 + 0.20                 | 75.4 GiB               |
| 50,000 list views and 10,000 detail views | (50000 × 20 × 0.03 + 10000 × 4 × 0.8) MiB | 60.6 GiB/month         |

Image averages are planning assumptions. Measure 50 representative images before adopting the budget and include quarantine, private masters, backups, evidence, database and storage operations. Storage volume, transfer and concurrency are different quantities; a 100 GB allowance does not prove capacity for 1000 concurrent users.

# 12 Retention, backups, operations and response
## Data retention policies
Measure days as elapsed UTC time and run purge daily within 24 hours of eligibility. Check evidence holds and references before deletion, record outcomes and allow safe retries. Replacing a name with Deleted member does not automatically remove every personal detail that users entered in free text.

| Reference | Period | Action |
|---|---|---|
| RET01<br>Unattached upload and raw input | 24 hours after upload or detachment; remove raw input within 24 hours of successful processing. | Delete temporary bytes; retain a processed private master only for a valid context, subject to a scoped evidence hold. |
| RET02<br>R2 server draft | 7 days after the last save; outside R1. | Delete the draft and its unattached media, without deleting separately published context media. |
| RET03<br>Archived listing or closed wanted request | Sold listings remain visible for 180 days then archive; archived listing or closed request content lasts 365 days after archive or closure. | Remove unheld text and media; retain a minimal pseudonymous reference where required and clear the conversation context snapshot. |
| RET04<br>Conversations, messages and attachments | 365 days after the last message, followed by a 30 day private archive before purge. | Purge due text and media; an evidence hold covers necessary items, not an automatic extension of the entire conversation. |
| RET05<br>Cases, appeals and evidence | 365 days after case closure; review holds every 30 days. | Purge due evidence and personal data; an overdue hold review triggers an alert, not silent release. |
| RET06<br>Account deletion | 30 day recovery window, then purge within 24 hours. | Remove login identity, email, avatar and identifiable profile data; keep a minimal pseudonymous identifier only where another policy requires history. |
| RET07<br>Notifications | 90 days after creation. | Purge automatically; member preferences remain until account deletion. |
| RET08<br>Audit, operations and deduplication | Audit 730 days; operational logs 14 days; API keys 24 hours; successful outbox records 30 days and failed records 90 days. | Minimize payloads and exclude secrets; permanent message and payment uniqueness remains for the life of the underlying records. |
| RET09<br>Independent backups | 7 daily and 4 weekly snapshots; normal recovery generations are no older than 28 days. | Encrypt and rotate independently; replay deletion and restriction records before reopening a restored service. |
| RET10<br>Contributions and financial receipts | Operator-configured retention_until is required before live collection and must match the operator’s accounting obligations. | Do not silently purge financial records without an approved period; retain only reference, amount, currency and state, not card data. |
| RET11<br>Deals and reviews | 730 days after completion, or cancellation for uncompleted Deals, subject to a scoped reviewed evidence hold. | Remove due comments and reviews from display and aggregates; retain only minimal pseudonymous references needed by another retained record. |
| RET12<br>Sessions, auth flows and quota records | Delete session secrets on revocation; session rows within 24 hours after expiry; non-secret flow metadata after 7 days; daily quota windows after their end plus 24 hours. | Erase provider tokens on consumption, revocation or expiry; never log an OTP or complete authentication link. |

These are operating design periods. Before live use the operator must establish actual service policies, entity/contact details, rights handling and accounting retention. A hold must not preserve the entire account indefinitely: define its object, reason, period and reviewer and alert on overdue review rather than silently deleting or extending it.

## OPS01 Consistent backups
A Postgres backup does not contain actual Storage objects, so media needs independent backup. Use immutable object keys, copy each new object with its checksum and produce a daily manifest matching database references to object versions. Do not declare a common recovery point until every referenced object is available. \[R13\]

Target no more than 24 hours of data loss and a four hour recovery for data, identity and media together, not the database alone. Separate source and backup deletion permissions and make encryption keys recoverable without exposing them in the report or repository. Detect failed backups or incomplete manifests before the last valid recovery point exceeds the target.

## OPS02 Restoration and rollback
1\. Each month restore a valid common point, including database, identity schema and media, into an isolated environment.

2\. Check relationships, constraints, record counts and image checksums; verify private access and every ready object reference.

3\. Reapply deletion, block, suspension and evidence-hold records and revoke all restored sessions before reopening.

4\. Reconcile contributions against the provider so restored state neither loses a prior success nor causes duplicate collection.

5\. Record duration, point, gaps and outcome. Roll back an application through a compatible prior image and expand migration, never by reversing a destructive migration.

## OPS03 Jobs and retries

| **Job**                                 | **Schedule**                                              | **Control**                                                                                |
|-----------------------------------------|-----------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Offer, proposal and pending Deal expiry | Every minute                                              | Also enforce expiry in direct requests using state and version; pending Deals last 7 days. |
| Accepted meeting reminder               | Two hours before if accepted before that point            | Deduplicate and recheck the current meeting state.                                         |
| Contribution reconciliation             | Every 5 minutes for the first hour, then daily for 7 days | Retrieve invoice/payment; unresolved unknowns remain in an alerted manual queue.           |
| Retention and media purge               | Daily                                                     | Check holds/references, remove derivatives and record deletion.                            |
| Hold and verification review            | Holds every 30 days; mailbox proof after one year         | Explicit alert and review; no silent extension.                                            |
| Health and cost                         | Minute health checks and daily cost report                | Alert on three consecutive failures or 80% and 100% budget thresholds.                     |

Outbox delivery is at least once, so each consumer needs its own idempotency key and state. Retry after one minute, then five, fifteen and sixty minutes, with a total of ten attempts before dead-letter and alert. Email failure does not undo committed business data, and provider acceptance is not proof of delivery to a phone.

## OPS04 Monitoring and incident response
Operations monitors error rate, API latency, event lag, media failures, backup age, storage and cost. The safety lead monitors reports, appeals and the 48 hour triage target. Assign an owner, backup and alert route before pilot; do not assume continuous staffing without actual resources.

For disclosure, data loss or payment failure, determine impact and timing, contain the cause through secret revocation or affected-route restriction, preserve limited evidence and inform the responsible decision maker. Recover from verified state and record cause, actions and follow-up. Member communications follow actual operator policy and obligations, not a legal guarantee inferred from this document.

## OPS05 Deployment and configuration checks
Changes pass code review, type checks, unit/integration/authorization tests and staging migrations. Build a pinned container and promote the same accepted artifact. Isolate branch previews from production data and origins. Validate APP_ORIGIN, TRUSTED_PROXY_CONFIG and identity/session/email/payment/backup secret references and financial retention at startup; refuse live activation if a required setting is missing.

# 13 Risks, resources, schedule and cost
## Risk assessment and review
Score likelihood and impact from 1 to 3 and multiply them. Scores 1-2 are low, 3-4 medium and 6-9 high. These are initial project judgments, not statistics about the reference site. Each risk remains open until treatment has evidence; residual scores are targets, not verified results.

![Figure 26 Initial risk matrix by likelihood and impact, with risk identifiers in the corresponding cells.](spec-assets/media/image30.png)

Figure 26 Initial risk matrix by likelihood and impact, with risk identifiers in the corresponding cells.

| Risk and score | Owner and treatment | Target residual |
|---|---|---|
| R01 Low adoption<br>3 x 3 = 9 | Product owner<br>Pilot with 50 real students and measure registration, posting and contact; do not fabricate member listings. | 2×3=6 |
| R02 Abuse fraud or data disclosure<br>3 x 3 = 9 | Safety lead<br>Use reporting, blocking, case-scoped access and abuse monitoring. | 2×3=6 |
| R03 Live payment activation delay<br>2 x 3 = 6 | Operator<br>Validate entity eligibility and service access early; retain working sandbox flows and record any scope change. | 1×3=3 |
| R04 Image cost growth<br>2 x 2 = 4 | Technical lead<br>Enforce quotas, measure real derivative sizes and alert at 80% and 100% of budget. | 1×2=2 |
| R05 Insufficient performance<br>2 x 2 = 4 | Technical lead<br>Index representative queries and measure 100, 500 and 1000 user workloads. | 1×2=2 |
| R06 Browser or device incompatibility<br>2 x 2 = 4 | QA lead<br>Test target phones, browsers, both languages and keyboard access. | 1×2=2 |
| R07 Scope growth and delay<br>3 x 2 = 6 | Project manager<br>Maintain an explicit R1 baseline, weekly review, reasoned changes and a 20% contingency. | 2×2=4 |
| R08 Database or media loss<br>2 x 3 = 6 | Operations lead<br>Back up both independently, test coordinated recovery and separate source and backup deletion powers. | 1×3=3 |
| R09 Provider or version changes<br>2 x 2 = 4 | Technical lead<br>Use supported pinned versions, adapters and exportable data with tested upgrade paths. | 1×2=2 |
| R10 Retention or privacy gaps<br>2 x 3 = 6 | Operator<br>Approve actual operator contact, policies, retention and permissions before live operation. | 1×3=3 |
| R11 Poor Arabic search<br>2 x 2 = 4 | Product lead<br>Build representative Arabic queries and test normalized indexing and retrieval quality. | 1×2=2 |
| R12 Insufficient moderation capacity<br>2 x 3 = 6 | Safety lead<br>Assign a moderator and backup, maintain a queue, 48 hour triage target and independent appeal route. | 1×3=3 |

Owners review the register weekly during delivery, then monthly and after incidents or provider/scope changes. Track p95, backup age, case-queue delay and 80% budget thresholds. A delayed commercial prerequisite changes the recorded schedule or scope rather than silently removing a baseline function.

## Effort by phase and role
This preliminary estimate covers complete R1 with two developers and part-time design, QA and project management. It includes identity, media, messaging, privacy, payments, administration, recovery and tests. Re-estimate after screen and contract agreement at the end of week two; it is not a quote or contractual commitment.

| **Phase**                | **Weeks** | **Dev** | **UX** | **QA** | **PM** | **Total** |
|--------------------------|-----------|---------|--------|--------|--------|-----------|
| Design and contracts     | 1-2       | 64      | 64     | 8      | 16     | 152       |
| Accounts and market      | 3-8       | 280     | 8      | 32     | 20     | 340       |
| Communication and safety | 9-15      | 328     | 8      | 44     | 20     | 400       |
| Support and operations   | 16-19     | 184     | 0      | 32     | 20     | 236       |
| Acceptance and release   | 20-23     | 184     | 0      | 44     | 20     | 248       |
| Total person-hours       |           | 1040    | 80     | 160    | 96     | 1376      |

| **Role**                       | **Base hours** | **With 20% reserve** | **Participation**                                                                    |
|--------------------------------|----------------|----------------------|--------------------------------------------------------------------------------------|
| Two full stack developers      | 1040           | 1248                 | 40 hours per developer per week at 70% net focus: 56 productive team hours per week. |
| Designer                       | 80             | 96                   | Part-time, including 64 hours in design and subsequent reviews.                      |
| QA                             | 160            | 192                  | Early contract review followed by progressive verification and acceptance.           |
| Product and project management | 96             | 115.2                | Decisions, coordination, scope and operational readiness.                            |
| Total                          | 1376           | 1651.2               | Round the effort allowance up to 1652 hours.                                         |

Plan 24-26 weeks from project start: core phases end in week 23, pilot acceptance in week 24 and final buffer through week 26. Reserved developer effort is 1248 ÷ 56, about 22.3 productive weeks; the calendar window allows sequencing and review. Do not divide all 1376 hours by developer capacity, since they include other roles, or mechanically double duration if staffing changes.

| **Phase** | **Developer work packages**                                                                      | **Exit evidence**                                                                 |
|-----------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------|
| 1         | Architecture/contracts 32 hours, setup/CI 16 and initial database 16.                            | Aligned screens, contracts, decisions and test environment.                       |
| 2         | Identity/session 64; profile/proof/deletion 48; wizard 56; media 48; search/wanted/favorites 64. | Field, ownership, media and account-rights tests.                                 |
| 3         | Conversation 72; attachments 48; live/outbox 64; offers 40; meetings 40; safety/admin 64.        | Two participants, unauthorized third party, races, block and moderation evidence. |
| 4         | Invoices/events 80; notifications 32; Deals/reviews 40; backup/monitoring 32.                    | Sandbox payment, reconciliation, restoration and channel tests.                   |
| 5         | Security/load 64; fixes 64; documentation/production/rollback 40; pilot 16.                      | Recorded test results and acceptance without unresolved P0/P1 defects.            |

Design and QA can overlap development, while negotiation depends on stable identity/context and live collection on G04. The 20% contingency is separate from 70% net focus and must not be counted twice. Price a contract using each role’s agreed hours and rate plus agreed expenses; this document invents no market wage. Post-launch moderation and operations are ongoing resources outside construction effort.

## Initial operating budget

| **Item**                  | **USD per month** | **Basis**                                                                                                    |
|---------------------------|-------------------|--------------------------------------------------------------------------------------------------------------|
| Railway                   | 40                | Initial app/worker usage allowance; do not automatically add the plan’s USD 20 minimum on top again. \[R21\] |
| Supabase                  | 35                | Assume Pro for the first project and one extra Micro staging project before overages. \[R22\]                |
| Resend                    | 20                | Transactional email allowance; review actual volume. \[R23\]                                                 |
| Media backups             | 10                | Planning allowance dependent on storage, operations and transfer.                                            |
| Monitoring                | 10                | Monitoring and alerts allowance; not every feature is assumed free.                                          |
| Domain and small expenses | 2                 | Monthly equivalent allowance, not a premium-domain quote.                                                    |
| Base total                | 117               | Before tax, payment fees and overages.                                                                       |
| 30% reserve               | 35.10             | Round planning to USD 155 per month.                                                                         |

At a planning conversion of SAR 3.75 per USD, USD 155 is approximately SAR 581.25. This is not a guaranteed cap: recheck pricing, region, usage, tax and provider fees before purchase. It excludes development, moderation staffing, migration and additional operator-selected services. Alert at 80% and 100% and review growth before disabling a baseline function.

# 14 Verification, acceptance tests and traceability
All TC01-TC84 cases in this document are Planned. The new software has not been tested because it has not yet been built. Document review checks identifier, reference, value, translation and layout consistency; it is not execution evidence or an application security assessment.

## Verification levels and result records
1\. Use unit tests for limits/transitions, integration tests for constraints and RLS, and E2E tests for workflows in both languages.

2\. Use two contextual participants, an unrelated third account, unconfirmed/restricted members, moderator, operator and independent reviewer, with non-personal fixtures.

3\. Control offer/block/closure races and use a test clock without changing production time.

4\. Run the defined workload, authorization/CSRF/CORS/secret/media checks and a coordinated database-and-object restoration.

5\. For every execution record TC ID, build, locale, environment, accounts, prerequisites, steps, actual result, evidence, date, tester and defect ID when failed.

| **Test** | **Scenario**                                                                         | **Expected result**                                                                                                                 | **Use cases**            |
|----------|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|--------------------------|
| TC01     | Incomplete signup and an already-used email                                          | Validate fields without disclosing another member’s account.                                                                        | UC01                     |
| TC02     | Failed then successful login with an unsafe return URL                               | Create no session on failure and reject external redirection.                                                                       | UC02                     |
| TC03     | Recovery link expiry and reuse                                                       | Apply the 60 minute lifetime and single consumption.                                                                                | UC02                     |
| TC04     | Combined filters and reset                                                           | Return intersection results and restore the default view.                                                                           | UC03                     |
| TC05     | Unavailable listing and a public profile without reviews                             | Show clear states without exposing private fields.                                                                                  | UC04                     |
| TC06     | Repeated favorite save and removal                                                   | Keep at most one relationship for the current member.                                                                               | UC05                     |
| TC07     | Corrupt image, eleven images and a forged media type                                 | Reject on the server while preserving entered text.                                                                                 | UC06                     |
| TC08     | Title 100 and 101; price 0, 50,000 and 50,000.01; three decimal places               | Accept exact boundaries and free items without offers; reject overflow and extra precision.                                         | UC06                     |
| TC09     | Return to earlier wizard steps and submit repeatedly                                 | Preserve valid inputs and create exactly one listing.                                                                               | UC06                     |
| TC10     | Edit another member’s listing or request                                             | Reject the action without changing the record.                                                                                      | UC07 UC09                |
| TC11     | Publish an urgent wanted request and change its state                                | Keep public and owner views consistent.                                                                                             | UC08 UC09                |
| TC12     | Two chat participants and an unrelated third account                                 | Allow only eligible participants to read messages and events.                                                                       | UC10                     |
| TC13     | Disconnect after message commit and before acknowledgment                            | Retry returns the same message without duplication.                                                                                 | UC10                     |
| TC14     | Offer zero, a negative amount and a valid amount                                     | Reject invalid offers and save a valid contextual card.                                                                             | UC11                     |
| TC15     | Concurrent accept and reject, then an attempted sender decision                      | Commit one authorized recipient decision only.                                                                                      | UC12                     |
| TC16     | Past meeting time, midnight boundary and timezone differences                        | Apply server time limits and display a consistent timezone.                                                                         | UC13 UC14                |
| TC17     | Block while a live connection is open                                                | Prevent new communication at the server and event boundary.                                                                         | UC16                     |
| TC18     | File, review and close a report                                                      | Keep a reasoned audit trail and reporter confidentiality.                                                                           | UC15                     |
| TC19     | Self-review, duplicate review and sold listing without confirmed Deal                | Reject ineligible reviews; require both confirmations.                                                                              | UC17                     |
| TC20     | Read another member’s notification or an inaccessible target                         | Reject disclosure and unauthorized navigation.                                                                                      | UC19                     |
| TC21     | Edit permitted profile fields, inject a role and sign out                            | Apply only permitted fields, reject injected roles and revoke the session.                                                          | UC20                     |
| TC22     | Preset and custom contribution followed by a back redirect                           | Use the correct amount and currency without showing unverified success.                                                             | UC18                     |
| TC23     | Forged, duplicate, early or wrong-environment payment event                          | Authenticate and independently verify provider state; apply its effect once.                                                        | UC18                     |
| TC24     | Mobile and desktop layouts, keyboard and both directions                             | Keep labels, focus, controls and content readable.                                                                                  | UC01 UC06 UC10 UC18      |
| TC25     | Unconfirmed account tries posting, chat, offers and upload                           | Reject market writes until email confirmation.                                                                                      | UC01 UC02 UC06 UC10 UC11 |
| TC26     | Expired or reused confirmation and rapid resend                                      | Enforce a one-time 24 hour link and RL03 without email enumeration.                                                                 | UC01 UC02                |
| TC27     | Change credentials and reuse an old session                                          | Complete the protected change and revoke old sessions and subscriptions.                                                            | UC02 UC20                |
| TC28     | Administrator without MFA or recent reauthentication, and repeated MFA-code guessing | Reject ineligible privileged access and enforce RL14 and provider limits on MFA attempts.                                           | UC02 UC21 UC24           |
| TC29     | Forged cursor, changed filters and equal prices                                      | Reject invalid cursors and preserve deterministic pagination.                                                                       | UC03                     |
| TC30     | Load at 100, 500 and 1000 concurrent users                                           | Use 100 for acceptance and the higher levels to measure scaling and limits.                                                         | UC03 UC10                |
| TC31     | HTML, malicious links and bidirectional control characters                           | Render safe text with clear numbers and identifiers, without script execution.                                                      | UC04 UC10 UC20           |
| TC32     | Forged image bytes, EXIF, oversized dimensions and worker failure                    | Reject bad inputs, strip metadata and never publish an unready derivative.                                                          | UC06 UC10                |
| TC33     | Reload within a tab and expire temporary uploads                                     | Preserve in-tab text and request expired images again; do not promise recovery after tab closure.                                   | UC06                     |
| TC34     | Restore archived sold content or an active archive after 90 days                     | Reject both; do not purge simply because 90 days elapsed.                                                                           | UC07                     |
| TC35     | Owner tries to edit or restore administratively hidden content                       | Reject the owner action; an authorized reversal retains previous state.                                                             | UC07 UC21                |
| TC36     | Concurrent Deal creation followed by confirmation after the seven day deadline       | One current Deal; cancel uncompleted records at expiry and reject late confirmation without reactivating a sold listing.            | UC07 UC17                |
| TC37     | Wanted budgets null, zero and 50,000 and text limits                                 | Distinguish unspecified from free and enforce consistent validation.                                                                | UC08                     |
| TC38     | Expiry at day 60, first and second reopening and day 90                              | Keep creation time fixed and apply the absolute lifetime cap.                                                                       | UC09                     |
| TC39     | Random UUIDs, two devices and self-sent messages                                     | Order by sequence, count incoming only and keep the read cursor monotonic.                                                          | UC10 UC19                |
| TC40     | Concurrent messages and a transaction failure                                        | Commit an ordered conversation sequence without duplicate rows or pre-commit broadcast.                                             | UC10                     |
| TC41     | Third-party image request, expired link and context substitution                     | Reject unauthorized downloads and keep the bucket private.                                                                          | UC10                     |
| TC42     | Untrusted WebSocket origin, logout and reconnection                                  | Reject untrusted subscriptions and recover committed gaps through REST.                                                             | UC10 UC20                |
| TC43     | Two pending offers in one conversation and acceptance in separate conversations      | Allow one pending offer per conversation; multiple acceptances do not reserve an item.                                              | UC11 UC12                |
| TC44     | Withdrawal racing with acceptance and acceptance after 72 hours                      | Apply exactly one valid transition and reject expired offers.                                                                       | UC11 UC12                |
| TC45     | Closure or blocking races with offer acceptance                                      | Use compatible locks; no prohibited write may commit after the restriction wins.                                                    | UC07 UC09 UC12 UC16      |
| TC46     | Meeting 29 minutes ahead, the 30 day limit and midnight                              | Enforce server boundaries and correct UTC and Riyadh conversion.                                                                    | UC13                     |
| TC47     | Late cancellation and attendance declarations                                        | Retain the cancellation and declarations without enabling a review automatically.                                                   | UC14 UC17                |
| TC48     | Duplicate report, unassigned reviewer and premature subject notification             | Keep a private reference and reveal neither reporter identity nor pre-decision allegations.                                         | UC15 UC21                |
| TC49     | Block races with a message and mutual unblocking                                     | Honor shared locking; removing one block does not remove the other or revive cancellations.                                         | UC16                     |
| TC50     | Review stars 0, 6 and 1.5 and the 30 day deadline                                    | Allow integer 1-5 only after both confirmations and within the window.                                                              | UC17                     |
| TC51     | Review editing and duplicate submission                                              | Keep one immutable author review; moderation hiding requires a recorded reason.                                                     | UC17 UC21                |
| TC52     | Tampered return amount, currency or invoice                                          | Never mark paid without an independent matching provider response.                                                                  | UC18                     |
| TC53     | Invalid webhook secret, refund after paid and an old event                           | Reject forgery, reconcile authoritative state and keep secrets out of logs.                                                         | UC18                     |
| TC54     | Invoice creation timeout, retry and environment mixing                               | Keep creating_unknown without blindly creating another invoice.                                                                     | UC18                     |
| TC55     | Disabled optional email, delivery failure and duplicate event                        | Keep one in-app notification, respect preferences and retain security email.                                                        | UC19 UC20                |
| TC56     | Logout and browser storage inspection                                                | Expose no provider token or service secret and revoke the server session and live channel.                                          | UC20                     |
| TC57     | Moderator attempts a permanent ban, role grant or unrelated chat access              | Enforce operator-only powers, MFA and case-scoped evidence access.                                                                  | UC21 UC24                |
| TC58     | Unapproved domain, mailbox change and injected verification fields                   | Reject forged proof; only server verification creates the limited badge.                                                            | UC22                     |
| TC59     | Deletion recovery on day 29, after day 30 and under a ban                            | Allow recovery only within the window while preserving the administrative restriction.                                              | UC23                     |
| TC60     | Restore database and images after account deletion                                   | Measure the RPO and RTO and reapply the deletion ledger before reopening.                                                           | UC21 UC23                |
| TC61     | Translate and deactivate a reference, delete a used value and add a public domain    | Keep references intact and prevent invalid selections and domain grants.                                                            | UC24                     |
| TC62     | Quota bypass across two application instances and shared campus IP                   | Use atomic central counters, 429 and Retry-After without a blanket shared-network lock.                                             | UC01 UC10 UC18           |
| TC63     | Untrusted origin and a non-browser client                                            | Apply precise CORS while keeping independent authentication and authorization.                                                      | UC02 UC10 UC21           |
| TC64     | Missing CSRF, invalid origin and a state-changing GET                                | Reject browser mutation; keep GET read-only and provider callbacks separately authenticated.                                        | UC06 UC10 UC18 UC20      |
| TC65     | Inject seller, sender or role fields and an external return URL                      | Derive authority from the session and context and reject unknown privileged fields.                                                 | UC06 UC10 UC20 UC21      |
| TC66     | Image byte, count, dimension and 200 MiB daily quota limits                          | Validate both authorization and actual bytes on the server.                                                                         | UC06 UC10                |
| TC67     | Account suspension or role change during a live session                              | Recheck current state and revoke stale privileges and private subscriptions.                                                        | UC02 UC21                |
| TC68     | Widths 360, 768 and 1440, keyboard, browsers and two phone platforms                 | Verify RTL and LTR, labels, focus, contrast and form layout.                                                                        | UC01 UC06 UC10 UC20      |
| TC69     | Deploy and roll back with an expand migration and worker interruption                | Run the previous compatible image and resume outbox work without reversing a destructive migration.                                 | UC21                     |
| TC70     | Missing payment event followed by later successful reconciliation                    | Use provider truth and a unique reference without duplicate contribution effects.                                                   | UC18                     |
| TC71     | Repeated purge and an overdue evidence hold review                                   | Keep purge idempotent and alert instead of silently deleting held evidence.                                                         | UC21 UC23                |
| TC72     | Release prerequisites, functional coverage and acceptance evidence                   | Record actual results, resolve P0/P1 defects and obtain an explicit release decision.                                               | UC21                     |
| TC73     | Offer SAR 0.99, 1 and 50,000 at UI and API boundaries                                | Reject 99 halalas and accept the exact 100-5,000,000 halala bounds everywhere.                                                      | UC11                     |
| TC74     | Confirm only one address during a login email change                                 | Keep the old email until both confirmations succeed; revoke sessions after completion.                                              | UC02 UC20                |
| TC75     | Reuse a chat image as an avatar or submit another owner’s upload                     | Reject wrong purpose, ownership, context and expired authorization; keep a safe avatar fallback.                                    | UC06 UC10 UC20           |
| TC76     | Member report tracking and case assignment access                                    | Expose only owned tracking records and explicitly assigned reviewer evidence.                                                       | UC15 UC21                |
| TC77     | Two participants submit attendance declarations and one cancels late                 | Store each author’s statement once within 72 hours, preserve history and do not assert the other party attended.                    | UC14                     |
| TC78     | Deal created from a wanted conversation without a seller-owned listing               | Require an explicit seller listing and matching buyer and seller; zero-price exchange remains eligible.                             | UC09 UC17                |
| TC79     | Create a dispute after Deal completion and attempt a second Deal                     | Preserve confirmations, freeze competing Deal creation and require an audited review; no external refund claim.                     | UC17 UC21                |
| TC80     | Public profile listing pagination, college deactivation and rating visibility        | Return public fields only, retain old reference meaning and recompute visible review aggregates.                                    | UC04 UC17 UC24           |
| TC81     | Share a deep link in either locale and enter mixed Arabic and Latin text             | Open the same resource, preserve locale and identifiers and count text consistently by Unicode code points.                         | UC03 UC04 UC20           |
| TC82     | Reload, close a tab, log out and switch accounts                                     | Preserve only eligible in-tab text; clear the old member’s draft on logout or account change and never promise closed-tab recovery. | UC06 UC20                |
| TC83     | Review retention and expired session or authentication flow purge                    | Remove expired public reviews from aggregates and delete provider tokens under RET11 and RET12.                                     | UC17 UC23                |
| TC84     | Failed payment attempt on an unpaid invoice followed by a successful attempt         | Retain pending until verified paid or definitively closed; a failed attempt cannot regress a paid invoice.                          | UC18                     |

## Direct traceability matrix
The matrix links every FR to a use case and specific tests; each API record retains its FR references. Links indicate designed coverage, not a pass. When a limit or state changes, update the rule, decision, contract, field and test together instead of appending a contradictory note.

| **Requirement** | **Use case**   | **Direct acceptance tests** |
|-----------------|----------------|-----------------------------|
| FR01            | UC01           | TC01 TC25 TC26              |
| FR02            | UC02           | TC02 TC27 TC28              |
| FR03            | UC02           | TC03 TC26                   |
| FR04            | UC02           | TC25 TC67                   |
| FR05            | UC20           | TC24 TC68 TC81              |
| FR06            | UC03           | TC04 TC05                   |
| FR07            | UC03           | TC04 TC29 TC30              |
| FR08            | UC03           | TC04                        |
| FR09            | UC03           | TC04                        |
| FR10            | UC03           | TC04                        |
| FR11            | UC03           | TC29                        |
| FR12            | UC03           | TC04                        |
| FR13            | UC04           | TC05 TC31 TC81              |
| FR14            | UC04           | TC05 TC80                   |
| FR15            | UC05           | TC06                        |
| FR16            | UC06           | TC07 TC08 TC09              |
| FR17            | UC06           | TC07 TC32 TC66              |
| FR18            | UC06           | TC08 TC31                   |
| FR19            | UC06           | TC08                        |
| FR20            | UC06           | TC16 TC46                   |
| FR21            | UC06           | TC09 TC33 TC82              |
| FR22            | UC06           | TC09                        |
| FR23            | UC07           | TC10 TC35                   |
| FR24            | UC07           | TC34 TC35                   |
| FR25            | UC08           | TC11 TC37                   |
| FR26            | UC08           | TC11 TC37                   |
| FR27            | UC09           | TC38                        |
| FR28            | UC07 UC09      | TC36 TC78                   |
| FR29            | UC10           | TC12 TC39                   |
| FR30            | UC10           | TC12 TC39                   |
| FR31            | UC10           | TC12 TC13 TC40              |
| FR32            | UC10           | TC12                        |
| FR33            | UC11           | TC14 TC73                   |
| FR34            | UC11           | TC14 TC43 TC73              |
| FR35            | UC12           | TC15 TC44 TC45              |
| FR36            | UC12 UC17      | TC19 TC47                   |
| FR37            | UC13           | TC16                        |
| FR38            | UC13           | TC16 TC46                   |
| FR39            | UC14           | TC47 TC77                   |
| FR40            | UC10 UC19      | TC40 TC42 TC67              |
| FR41            | UC10 UC11      | TC09 TC13 TC54              |
| FR42            | UC11 UC13      | TC38 TC45                   |
| FR43            | UC15           | TC18 TC48                   |
| FR44            | UC16           | TC17 TC49                   |
| FR45            | UC15           | TC18 TC48 TC76              |
| FR46            | UC15           | TC24 TC68                   |
| FR47            | UC17           | TC19 TC50 TC51              |
| FR48            | UC19           | TC20 TC55                   |
| FR49            | UC20           | TC21 TC27 TC56              |
| FR50            | UC18           | TC22                        |
| FR51            | UC18           | TC22 TC54                   |
| FR52            | UC18           | TC22 TC52                   |
| FR53            | UC18           | TC23 TC53 TC70 TC84         |
| FR54            | UC21           | TC57 TC76                   |
| FR55            | UC24           | TC61 TC80                   |
| FR56            | UC18           | TC22 TC52                   |
| FR57            | UC01 UC02      | TC25 TC26                   |
| FR58            | UC22           | TC58                        |
| FR59            | UC02 UC20      | TC27 TC74                   |
| FR60            | UC06           | TC33 TC82                   |
| FR61            | UC06 UC10      | TC32 TC41 TC66 TC75         |
| FR62            | UC10           | TC39                        |
| FR63            | UC16 UC20      | TC49                        |
| FR64            | UC10 UC19      | TC39                        |
| FR65            | UC11 UC12 UC14 | TC44 TC47 TC77              |
| FR66            | UC07 UC17      | TC36 TC50 TC78 TC79         |
| FR67            | UC15 UC21      | TC48 TC57 TC76              |
| FR68            | UC19 UC20      | TC55                        |
| FR69            | UC10           | TC41 TC75                   |
| FR70            | UC20           | TC72                        |
| FR71            | UC18 UC21      | TC23 TC54 TC72              |
| FR72            | UC23           | TC59                        |
| FR73            | UC21 UC23      | TC71 TC83                   |
| FR74            | UC01 UC10 UC18 | TC62 TC66                   |
| FR75            | UC18 UC21      | TC40 TC69 TC70              |
| FR76            | UC21           | TC60                        |
| FR77            | UC21 UC22 UC24 | TC28 TC57                   |
| FR78            | UC02 UC21      | TC57 TC59 TC67              |
| FR79            | UC07 UC09 UC16 | TC45 TC49                   |
| FR80            | UC06 UC10 UC18 | TC13 TC32 TC54              |

# 15 Launch prerequisites and developer handover
Detailed design and construction can start from this specification with a recorded baseline and operating values delivered on time. G items are Not evidenced in this document at publication. Do not assume an entity, domain, live account or facility list that has not been supplied. Use sandbox services and clearly marked fixtures until actual configuration is enabled.

| Prerequisite | Owner and deadline | Required evidence |
|---|---|---|
| G01<br>Project identity and domain | Product owner<br>Week 2 | An authorized name and logo and a project-owned domain; no assumed ownership of souqjamia.com. |
| G02<br>Campus reference data | Catalog operator<br>Week 2 | Approved CSV of public locations and optional colleges, with Arabic and English labels and a source. |
| G03<br>University email domains | Operator<br>Before enabling the badge | A validated domain list; the badge remains off until approved without blocking the marketplace. |
| G04<br>Live contribution account | Operator<br>Before phase 4 acceptance | Entity eligibility, live credentials, verified webhook and a financial retention setting. |
| G05<br>Production email | Operations lead<br>Before phase 2 acceptance | Project-owned sending domain, SPF and DKIM, delivery monitoring and an actual contact address. |
| G06<br>Operating policies | Operator<br>Before public pilot | Operator identity and contact, retention, moderation, appeals and an explanation of optional financial support. |
| G07<br>Budget and monitoring | Operations lead<br>Before public pilot | Project-owned service accounts, cost alerts, independent backups and least-privilege access. |
| G08<br>Acceptance and release record | Product owner and QA<br>Before production release | Recorded test results, no unresolved P0/P1 defects and an explicit release decision. |

## Definition of done for a function
A function is done when it has usable Arabic and English UI, input/result contracts, server validation and constraints, owner/third-party authorization, loading/empty/failure/recovery behavior, recorded positive and negative tests and audit for sensitive work. Review mobile, keyboard and mixed text and update dictionary, contract and traceability with the code.

## Required handover deliverables
1\. Project-owned repository, change history, local setup instructions and a secret-free .env.example.

2\. Approved screens, shared components, complete locale resources and repeatable migrations/reference seeds with sources.

3\. Actual OpenAPI contract, updated data diagrams, constraint/authorization/concurrency tests and TC execution records.

4\. Containers and deployment, backup, object-manifest, restore, rollback and alerting instructions with a timed recovery exercise.

5\. Project-owned service and billing accounts, private secret handover and revocation of temporary developer access.

6\. Acceptance record distinguishing executed work, remaining defects and release approver, plus operator guidance for reports, appeals, deletion and payment reconciliation.

## Release acceptance and change control
P0 is critical service stoppage or sensitive-data exposure; P1 includes data loss, authorization bypass or a core function unusable without an acceptable workaround. Do not release R1 with either unresolved. Contributions require sandbox and reconciliation evidence and G04 before live collection. Release also requires measured recovery, project-owned accounts and an explicit release decision.

A change request records reason, affected functions, data/contracts/security/tests, effort, schedule and approver. University badges remain disabled until domain approval without stopping the marketplace. Omitting contributions or another R1 function is an explicit scope change, not full baseline delivery simply because the other pages work.

# 16 References, catalogs and evidence inventory
## Project sources

| **Reference** | **Material**                                        | **Use**                                                                                            |
|---------------|-----------------------------------------------------|----------------------------------------------------------------------------------------------------|
| D01           | Supplied engineering analysis in Word and Markdown. | UI detail and proposals; corrected original-technology claims, routing and assumptions.            |
| D02           | code_artifact.md                                    | Proposal reference, not approved migrations or production code.                                    |
| D03           | Original 58-page engineering report.                | Source of stable identifiers and observed evidence.                                                |
| D04           | SouqJamia-Complete-Supplement.md                    | Supplement decisions incorporated with contradiction corrections.                                  |
| D05           | SouqJamia_Developer_Specification_AR_v2             | Prior merged edition superseded by this revision.                                                  |
| S01-S20       | Owner-supplied screenshots.                         | Limited visual evidence; four non-sensitive screenshots are reproduced and the others inventoried. |
| L             | https://souqjamia.com/                              | Earlier public inspection dated 15 November 2026, not an account or collection test.               |

Public source routes include home, marketplace, wanted, sell, account, contribution, privacy, terms, guidance, listing details and public profile. This document includes no live checkout-session link, key or personal email from screenshots. Migrating original-site content or members is outside construction scope.

## Previous observation ledger

| **Reference** | **Action**                           | **Observation**                                                                |
|---------------|--------------------------------------|--------------------------------------------------------------------------------|
| OBS01         | Open home and marketplace            | Seven public listings in the earlier inspection.                               |
| OBS02         | Select electronics                   | Three matching listings.                                                       |
| OBS03         | Add Good condition                   | Two listings at the intersection of the filters.                               |
| OBS04         | Add HONOR search                     | One matching listing.                                                          |
| OBS05         | Sort price ascending                 | SAR 1, 55, 55, 200, 480, 900 and 1200 in that order.                           |
| OBS06         | Select housing unit 25               | Only HONOR remained, then the filters were reset.                              |
| OBS07         | Open gallery and seller profile      | The selected image changed and an empty reviews tab opened.                    |
| OBS08         | Attempt private actions as a visitor | Login was required; no private write was performed.                            |
| OBS09         | Switch language                      | Navigation and community guidance changed language.                            |
| OBS10         | Choose custom support then SAR 15    | The button updated and Stripe opened for SAR 15.00.                            |
| OBS11         | Return from hosted checkout          | A cancellation notice appeared; no card data was entered or payment performed. |

## Official design references
**R01 OMG UML 2.5.1**

<https://www.omg.org/spec/UML/2.5.1>

**R02 OWASP Authorization**

<https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html>

**R03 Supabase RLS**

<https://supabase.com/docs/guides/database/postgres/row-level-security>

**R04 Stripe Checkout fulfillment for reference evidence**

<https://docs.stripe.com/checkout/fulfillment>

**R05 Stripe Webhooks for reference evidence**

<https://docs.stripe.com/webhooks>

**R06 W3C WCAG2.2**

<https://www.w3.org/WAI/WCAG22/quickref/>

**R07 OWASP CSRF Prevention**

<https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html>

**R08 OWASP CORS Security**

<https://cheatsheetseries.owasp.org/cheatsheets/CORS_Security_Cheat_Sheet.html>

**R09 PostgreSQL UUID functions**

<https://www.postgresql.org/docs/18/functions-uuid.html>

**R10 NIST Authentication guidance**

<https://pages.nist.gov/800-63-4/sp800-63b.html>

**R11 Supabase Password security**

<https://supabase.com/docs/guides/auth/password-security>

**R12 Supabase Storage access**

<https://supabase.com/docs/guides/storage/buckets/fundamentals>

**R13 Supabase Database backups**

<https://supabase.com/docs/guides/platform/backups>

**R14 Moyasar Hosted invoices**

<https://docs.moyasar.com/api/invoices/01-create-invoice>

**R15 Moyasar Webhook reference**

<https://docs.moyasar.com/api/other/webhooks/webhook-reference>

**R16 Moyasar Fetch Payment**

<https://docs.moyasar.com/api/payments/02-fetch-payment>

**R17 Moyasar Idempotency**

<https://docs.moyasar.com/api/idempotency>

**R18 Moyasar API authentication**

<https://docs.moyasar.com/api/authentication>

**R19 Next.js support policy**

<https://nextjs.org/support-policy>

**R20 Railway WebSocket limits**

<https://docs.railway.com/networking/public-networking/specs-and-limits>

**R21 Railway pricing**

<https://docs.railway.com/pricing/plans>

**R22 Supabase pricing**

<https://supabase.com/pricing>

**R23 Resend pricing**

<https://resend.com/pricing?volume=50000>

**R24 OWASP Password storage and bcrypt limit**

<https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html>

**R25 OWASP Session management**

<https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html>

**R26 Supabase Send Email Hook**

<https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook>

**R27 Supabase email expiry**

<https://supabase.com/docs/guides/auth/auth-email-passwordless>

**R28 Moyasar webhook verification**

<https://docs.moyasar.com/api/other/webhooks/verify-webhook>

**R29 PostgreSQL pg_trgm text similarity**

<https://www.postgresql.org/docs/current/pgtrgm.html>

Relevant technical references were reviewed during specification preparation; this revision rechecked Supabase link expiry and both-address confirmation and Moyasar webhook/invoice behavior. Recheck prices, versions and features at procurement and deployment. A source supports a design choice, not proof that the reference site uses the same technology.

## Market categories and item conditions

| **Key**             | **Arabic label**                                                                                                                          | **English label**          |
|---------------------|-------------------------------------------------------------------------------------------------------------------------------------------|----------------------------|
| books_study         | <span dir="rtl">الكتب</span> <span dir="ltr"></span><span dir="rtl">والدراسة</span>                                                       | Books and study            |
| electronics         | <span dir="rtl">الإلكترونيات</span>                                                                                                       | Electronics                |
| room_furniture      | <span dir="rtl">الأثاث</span> <span dir="ltr"></span><span dir="rtl">والسكن</span>                                                        | Furniture and housing      |
| university_supplies | <span dir="rtl">المستلزمات</span> <span dir="ltr"></span><span dir="rtl">الجامعية</span>                                                  | University supplies        |
| clothing_personal   | <span dir="rtl">الملابس</span> <span dir="ltr"></span><span dir="rtl">والعناية</span>                                                     | Clothing and personal care |
| vehicles            | <span dir="rtl">وسائل</span> <span dir="ltr"></span><span dir="rtl">التنقل</span> <span dir="ltr"></span><span dir="rtl">والمركبات</span> | Transport and vehicles     |
| other               | <span dir="rtl">أخرى</span>                                                                                                               | Other                      |

| **Key**   | **Arabic meaning**                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | **English meaning**                                     |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------|
| new_boxed | <span dir="rtl">جديد</span> <span dir="ltr"></span><span dir="rtl">بالكرتون؛</span> <span dir="ltr"></span><span dir="rtl">مغلق</span> <span dir="ltr"></span><span dir="rtl">وغير</span> <span dir="ltr"></span><span dir="rtl">مستخدم</span> <span dir="ltr"></span><span dir="rtl">في</span> <span dir="ltr"></span><span dir="rtl">عبوته</span> <span dir="ltr"></span><span dir="rtl">الأصلية</span><span dir="ltr">.</span>                                                     | New boxed; sealed and unused in the original packaging. |
| like_new  | <span dir="rtl">كالجديد؛</span> <span dir="ltr"></span><span dir="rtl">حالة</span> <span dir="ltr"></span><span dir="rtl">ممتازة</span> <span dir="ltr"></span><span dir="rtl">دون</span> <span dir="ltr"></span><span dir="rtl">علامات</span> <span dir="ltr"></span><span dir="rtl">استخدام</span> <span dir="ltr"></span><span dir="rtl">واضحة</span><span dir="ltr">.</span>                                                                                                      | Like new; excellent with no obvious signs of use.       |
| good      | <span dir="rtl">بحالة</span> <span dir="ltr"></span><span dir="rtl">جيدة؛</span> <span dir="ltr"></span><span dir="rtl">يعمل</span> <span dir="ltr"></span><span dir="rtl">بكفاءة</span> <span dir="ltr"></span><span dir="rtl">مع</span> <span dir="ltr"></span><span dir="rtl">علامات</span> <span dir="ltr"></span><span dir="rtl">استخدام</span> <span dir="ltr"></span><span dir="rtl">طبيعية</span><span dir="ltr">.</span>                                                     | Good; functional with normal signs of use.              |
| fair      | <span dir="rtl">مقبول؛</span> <span dir="ltr"></span><span dir="rtl">يعمل</span> <span dir="ltr"></span><span dir="rtl">مع</span> <span dir="ltr"></span><span dir="rtl">آثار</span> <span dir="ltr"></span><span dir="rtl">استخدام</span> <span dir="ltr"></span><span dir="rtl">ظاهرة</span><span dir="ltr">.</span>                                                                                                                                                                | Fair; functional with visible wear.                     |
| used      | <span dir="rtl">مستعمل؛</span> <span dir="ltr"></span><span dir="rtl">غرض</span> <span dir="ltr"></span><span dir="rtl">مستعمل</span> <span dir="ltr"></span><span dir="rtl">مناسب</span> <span dir="ltr"></span><span dir="rtl">للاستعمال</span> <span dir="ltr"></span><span dir="rtl">اليومي</span> <span dir="ltr"></span><span dir="rtl">مع</span> <span dir="ltr"></span><span dir="rtl">وصف</span> <span dir="ltr"></span><span dir="rtl">عيوبه</span><span dir="ltr">.</span> | Used; suitable for daily use with defects described.    |

The screenshots partially show housing units 1-6, and earlier browsing showed unit 25. This does not establish a complete facility list or meeting authorization. The operator supplies approved location and college CSVs before production seeding. Do not use an individual’s college or residence details from screenshots as test data.

## Screenshot inventory and evidentiary limits

| **Image** | **File**                   | **Content and limit**                                                                                     |
|-----------|----------------------------|-----------------------------------------------------------------------------------------------------------|
| S01       | image(20261114-230505).png | Private profile and activity links; contains a visible personal email, which is not reproduced.           |
| S02       | image(20261114-230510).png | Duplicate profile capture with a screenshot artifact; no additional function established.                 |
| S03       | image(20261114-230518).png | Contribution amount choices with SAR 15 selected and one-time support wording.                            |
| S04       | image(20261114-230526).png | Duplicate contribution page; no additional behavior established.                                          |
| S05       | image(20261114-230531).png | Hosted Stripe checkout form; reaching the form does not prove a payment.                                  |
| S06       | image(20261114-230540).png | First wizard step with allowed image formats and maximum ten images.                                      |
| S07       | image(20261114-230547).png | Duplicate image-upload step with a capture artifact.                                                      |
| S08       | image(20261114-230558).png | Empty desktop split inbox, list search and no-conversation state.                                         |
| S09       | image(20261114-230600).png | Community guidance on respectful dealing, accurate description and fraud.                                 |
| S10       | image(20261114-230602).png | Final listing review with edit links and publish control, not proof of publication.                       |
| S11       | image(20261114-230605).png | Public meeting privacy warning and wizard navigation controls.                                            |
| S12       | image(20261114-230608).png | Campus location step with housing options.                                                                |
| S13       | image(20261114-230612).png | Price step showing zero and a disabled continue control; free-item behavior is a new design decision.     |
| S14       | image(20261114-230619).png | Specifications, five item-condition choices and required description.                                     |
| S15       | image(20261114-230625).png | Title with a 100-character counter, category and condition controls.                                      |
| S16       | image(20261114-232025).png | Mobile price-offer dialog with reference and proposed amount.                                             |
| S17       | image(20261114-232034).png | Mobile meeting dialog with location, date, time and optional note.                                        |
| S18       | image(20261114-232039).png | Mobile conversation context and message, offer and meeting controls.                                      |
| S19       | image(20261114-232051).png | Conversation menu showing report and block actions, not evidence that either was executed.                |
| S20       | image(20261114-232101).png | Mobile inbox with one conversation and a last-message preview, not delivery or read-performance evidence. |

## Terminology glossary

| **Term**       | **Definition**                                                                                              |
|----------------|-------------------------------------------------------------------------------------------------------------|
| FR / UC / BR   | Functional requirement, use case and business rule.                                                         |
| DEC / TC / G   | Design decision, planned acceptance test and external launch prerequisite.                                  |
| BFF            | Backend for the frontend, holding session and identity secrets.                                             |
| RLS            | Row-level access rules using verified identity, ownership and relationship.                                 |
| Idempotency    | Repeating a logical request without duplicating its effect.                                                 |
| Outbox / Inbox | An event committed with its transaction, and a durable incoming event record before processing.             |
| Tombstone      | A minimal pseudonymous reference preserving relationships after content removal.                            |
| Legal hold     | A scoped evidence hold with reason, object, period and review.                                              |
| RPO / RTO      | Target maximum recovery-point loss and target service restoration time.                                     |
| SLO / SLA      | Internal service objective and contractual service agreement, which this document alone does not establish. |
| R1 / R2 / R3   | Defined first release followed by separately scoped later additions.                                        |
