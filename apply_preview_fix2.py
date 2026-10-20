filepath = 'vaylo ad web app/site-preview.html'

# The file currently has the old CSS (from the broken template).
# We replace the <style>...</style> block with the new complete CSS.
with open(filepath, 'r', encoding='utf-8') as f:
    old = f.read()

s = old.find('<style>')
e = old.find('</style>')

# Read the new full CSS from a separate file
with open('vaylo ad web app/site-preview-new.css', 'r', encoding='utf-8') as f:
    new_style = f.read()

new_content = old[:s] + new_style + old[e + 9:]

with open(filepath, 'w', encoding='utf-8') as f:
    f.write(new_content)

print('written', len(new_content), 'bytes')
