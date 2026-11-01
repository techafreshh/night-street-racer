shader_type spatial;
render_mode specular_disabled;

uniform vec4 base_color : source_color = vec4(0.25, 0.25, 0.27, 1.0);
uniform vec4 line_color : source_color = vec4(0.45, 0.45, 0.48, 1.0);
uniform float cells = 100.0;
uniform float line_width = 0.05;

void fragment() {
	vec2 g = abs(fract(UV * cells) - 0.5);
	float line = 1.0 - smoothstep(0.0, line_width, 0.5 - min(g.x, g.y));
	ALBEDO = mix(base_color.rgb, line_color.rgb, line);
	ROUGHNESS = 0.95;
}
