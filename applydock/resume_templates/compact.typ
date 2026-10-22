// Compact: the same single-column structure with tighter type and spacing for one-page resumes.
// Its default design values live in resume_model.LAYOUT_PRESETS["compact"].
#import "_common.typ": resume

#resume(json(bytes(sys.inputs.resume)))
