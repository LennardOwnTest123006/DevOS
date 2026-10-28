import ast, sys
src = open(sys.argv[1], encoding="utf-8", errors="replace").read()
try:
    ast.parse(src, sys.argv[1])
except SyntaxError as e:
    print("%s:%d:%d: error: %s" % (sys.argv[1], e.lineno or 1, e.offset or 1, e.msg))
    sys.exit(1)
