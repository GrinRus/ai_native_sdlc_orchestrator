# Public Boundary Leak Fixture

This fixture intentionally contains a private-shaped artifact field so the
boundary regression test can prove the scanner fails closed:

```yaml
live_e2e_step_quality_assessment_report_files: []
```
