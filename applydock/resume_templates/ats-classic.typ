// ATS Classic: single column, centered header, standard spacing. Its default design values
// live in resume_model.LAYOUT_PRESETS["ats-classic"]; users can adjust them in the Design tab.
#import "_common.typ": resume

#resume(json(bytes(sys.inputs.resume)))
