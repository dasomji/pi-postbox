# Postbox audit remediation: issues #86–#92

Date: 2026-08-15

## Result

All seven audit findings were fixed sequentially, committed independently, and closed on GitHub.

| Issue | Commit | Outcome |
| --- | --- | --- |
| [#86](https://github.com/dasomji/pi-postbox/issues/86) | `93ea3ea` | Bounded `get_answer` waits and returned correlated ownership errors immediately. |
| [#87](https://github.com/dasomji/pi-postbox/issues/87) | `5b0947c` | Made the owner scope of open-Question counts explicit. |
| [#88](https://github.com/dasomji/pi-postbox/issues/88) | `09176e0` | Defaulted Question discovery to the caller's owner and required explicit broadening. |
| [#89](https://github.com/dasomji/pi-postbox/issues/89) | `695b4d6` | Included `parentQuestionId` in complete Question details. |
| [#90](https://github.com/dasomji/pi-postbox/issues/90) | `6e81e97` | Added independent ownership revisions and concurrency checks. |
| [#91](https://github.com/dasomji/pi-postbox/issues/91) | `9c42ff5` | Separated lifecycle-only resolutions from human Answer metadata and reads. |
| [#92](https://github.com/dasomji/pi-postbox/issues/92) | `ff429c1` | Returned ordered `localRef`→`questionId` batch mappings with revision and disposition. |

## Validation

- Each issue received focused regression coverage before its commit.
- Final working-tree build and full suite passed: **93 test files, 560 tests**.
- The selectively staged #92 tree independently passed build and the full baseline suite: **93 test files, 557 tests**.
- `git diff --check` passed.
- All issues #86–#92 are closed.

## Delivery note

The commits are local and have not been pushed. Pre-existing unrelated working-tree edits were preserved and excluded from every issue commit.
