import sys
try:
    import yaml
except ImportError:
    sys.exit(0)
try:
    list(yaml.safe_load_all(open(sys.argv[1], encoding="utf-8")))
except yaml.YAMLError as e:
    m = getattr(e, "problem_mark", None)
    print("%s:%d:%d: error: %s" % (sys.argv[1], (m.line + 1) if m else 1, (m.column + 1) if m else 1, getattr(e, "problem", str(e))))
    sys.exit(1)
