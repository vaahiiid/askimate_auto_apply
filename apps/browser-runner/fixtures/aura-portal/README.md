# The hostile Aura fixture

A miniature Salesforce Experience Cloud portal that **tries to do every
prohibited thing on page load**, so the inspection guard is proven against
behaviour rather than against intent.

It attempts, unprompted:

| | Attempt | Must be |
|---|---|---|
| 1 | POST an Aura batch that creates an application record | BLOCKED |
| 2 | POST an Aura batch that saves applicant data | BLOCKED |
| 3 | POST to `/services/apply/submitApplication` | BLOCKED |
| 4 | POST a multipart file upload | BLOCKED |
| 5 | Navigate to a consequential endpoint | BLOCKED |
| 6 | POST a non-cacheable Apex action | BLOCKED |
| 7 | PUT and DELETE | BLOCKED |
| 8 | POST the *rendering* Aura batch that draws the form | **ALLOWED** |

8 is the point. A guard that blocks everything is trivial and useless; this
fixture only passes if the interface actually renders.
