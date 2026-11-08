from pathlib import Path
import json,re
from lxml import html
root=Path(__file__).parent
d=html.fromstring((root/'site.html').read_text(encoding='utf-8'))
parts=[]
for script in d.xpath('//script[not(@src)]/text()'):
    for match in re.finditer(r'self\.__next_f\.push\((\[.*?\])\)\s*;?$',script,re.S):
        value=json.loads(match.group(1))
        if len(value)>1 and isinstance(value[1],str): parts.append(value[1])
faqs=[]
def walk(node):
    if isinstance(node,dict):
        if isinstance(node.get('q'),str) and isinstance(node.get('a'),str):faqs.append(node)
        for value in node.values():walk(value)
    elif isinstance(node,list):
        for value in node:walk(value)
for line in ''.join(parts).splitlines():
    _,_,payload=line.partition(':')
    try:walk(json.loads(payload))
    except (ValueError,TypeError):pass
(root/'official-faq.json').write_text(json.dumps(faqs,ensure_ascii=False,indent=2),encoding='utf-8')
print('Official FAQ count:',len(faqs))
for item in faqs:print(json.dumps(item,ensure_ascii=False))
