import pytest

from app.validate import extract_html_document, extract_regions, validate_app


def test_known_good_app_passes(good_html):
    report = validate_app(good_html)
    assert report.errors == []
    assert len(report.ids) == 7
    assert set(report.regions) == set(report.ids)


def test_languages_are_detected_from_position(good_html):
    regions, errors = extract_regions(good_html)
    assert errors == []
    assert [r.language for r in regions["total-card"]] == ["html", "js"]


def test_markers_do_not_leak_into_snippets(good_html):
    regions, _ = extract_regions(good_html)
    for rs in regions.values():
        for r in rs:
            assert "@explain" not in r.code and "@end" not in r.code


def test_extracts_html_from_fenced_and_chatty_reply(good_html):
    reply = "Sure! Here is your app:\n```html\n" + good_html + "\n```\nHope that helps."
    assert extract_html_document(reply) == good_html.strip()


def broken(good_html, old, new, count=1):
    assert old in good_html, f"test setup: {old!r} not found"
    return good_html.replace(old, new, count)


@pytest.mark.parametrize(
    "mutation, expected",
    [
        (lambda h: broken(h, "  // @end:delete-button\n", ""), "never closed"),
        (lambda h: broken(h, "// @explain:delete-button\n", ""), "no matching @explain"),
        (lambda h: broken(h, "  // @explain:amount-input\n", "").replace("  // @end:amount-input\n", ""), "has no code region"),
        (lambda h: h.replace("render();\n</script>", "localStorage.setItem('a','b');\nrender();\n</script>"), "storage"),
        (lambda h: h.replace("render();\n</script>", "fetch('/x');\nrender();\n</script>"), "network"),
        (lambda h: h.replace("render();\n</script>", "confirm('sure?');\nrender();\n</script>"), "alert/confirm/prompt"),
        (lambda h: h.replace("<head>", '<head><script src="https://cdn.example.com/x.js"></script>'), "external"),
        (lambda h: h.replace("<head>", '<head><link rel="stylesheet" href="https://x.com/a.css">'), "<link>"),
        (lambda h: h.replace("render();\n</script>", "window.parent.postMessage(1,'*');\nrender();\n</script>"), "window.parent"),
        (lambda h: h.split("</script>")[0], "incomplete"),                      # truncated model output
        (lambda h: "\n".join(h.split("\n")[:60]), "Too short"),
        (lambda h: h + "\n" * 300, "Too long"),
    ],
)
def test_rejects_broken_apps(good_html, mutation, expected):
    report = validate_app(mutation(good_html))
    assert report.errors, "expected validation errors"
    assert any(expected.lower() in e.lower() for e in report.errors), report.errors


def test_variable_named_parent_is_not_a_false_positive(good_html):
    html = good_html.replace("render();\n</script>", "const parent = listEl.parentElement; parent.classList.add('x');\nrender();\n</script>")
    assert validate_app(html).errors == []


def test_too_few_tagged_elements(good_html):
    html = good_html
    for rid in ("delete-button", "filter-chips", "expense-list"):
        html = html.replace(f'data-explain="{rid}"', "")
    report = validate_app(html)
    assert any("Found 4" in e or "use 6-8" in e for e in report.errors)


def test_region_spanning_languages_is_rejected():
    html = "<style>\n/* @explain:x */\na{}\n</style>\n<script>\n/* @end:x */\n</script>"
    _, errors = extract_regions(html)
    assert any("starts in css but ends in js" in e for e in errors)


def test_line_numbers_stay_truthful_when_a_region_has_blank_edges():
    html = "<script>\n// @explain:x\n\n  const a = 1;\n  const b = 2;\n\n// @end:x\n</script>"
    regions, errors = extract_regions(html)
    assert errors == []
    r = regions["x"][0]
    assert r.code == "const a = 1;\nconst b = 2;"
    lines = html.split("\n")
    assert [l.strip() for l in lines[r.start_line - 1 : r.end_line]] == ["const a = 1;", "const b = 2;"]


def test_rejects_an_in_app_explain_feature(good_html):
    html = good_html.replace('data-explain="total-card"', 'data-explain="explain-mode-toggle"').replace(
        "@explain:total-card", "@explain:explain-mode-toggle").replace("@end:total-card", "@end:explain-mode-toggle")
    assert any("explain/learning feature" in e for e in validate_app(html).errors)


def test_orphan_region_is_ignored_not_fatal(good_html):
    # expense-list loses its tag but keeps its code region: 6 elements remain, so the app is still accepted
    html = good_html.replace('<ul id="list" data-explain="expense-list">', '<ul id="list">')
    report = validate_app(html)
    assert report.errors == []
    assert "expense-list" not in report.ids and "expense-list" not in report.regions
    assert len(report.ids) == 6


def test_every_legitimate_tagging_style_is_recognised():
    from app.validate import tagged_ids
    html = (
        '<div data-explain="plain"></div>\n'
        "<script>const a = \"<div data-explain=\\\"escaped-quotes\\\"></div>\";\n"
        "el.setAttribute('data-explain', 'via-set-attribute');\n"
        "el.dataset.explain = 'via-dataset';\n"
        "const b = `<b data-explain='single-quoted'></b>`; </script>\n"
        "<i data-explain=unquoted></i>"
    )
    assert tagged_ids(html) == ["plain", "escaped-quotes", "via-set-attribute", "via-dataset", "single-quoted", "unquoted"]
