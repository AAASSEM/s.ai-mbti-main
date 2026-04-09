import json
import re

def parse_mbti_file(file_path):
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    # Mapping of index to persona
    persona_map = {
        "0": "AGNOSTIC",
        "1": "INTJ", "2": "INTP", "3": "ENTJ", "4": "ENTP",
        "5": "INFJ", "6": "INFP", "7": "ENFJ", "8": "ENFP",
        "9": "ISTJ", "10": "ISFJ", "11": "ESTJ", "12": "ESFJ",
        "13": "ISTP", "14": "ISFP", "15": "ESTP", "16": "ESFP"
    }

    topics = {
        "1": "topic_1_trees",
        "2": "topic_2_bystander",
        "3": "topic_3_headphones"
    }

    # Regex to find chunks
    # Example: ## File: 1.0.txt \nContent\n
    pattern = r"## File: (\d+)\.(\d+)\.txt.*?\n(.*?)(?=\n## File:|\n---|\Z)"
    matches = re.finditer(pattern, content, re.DOTALL)

    seed_data = []

    for match in matches:
        topic_num = match.group(1)
        sub_num = match.group(2)
        body = match.group(3).strip()
        
        if topic_num in topics and sub_num in persona_map:
            seed_data.append({
                "topic_id": topics[topic_num],
                "target_persona": persona_map[sub_num],
                "content_body": body
            })

    return seed_data

if __name__ == "__main__":
    data = parse_mbti_file(r"c:\Users\20100\s.ai-mbti-main\MBTI_Final_Cleaned.md")
    with open(r"c:\Users\20100\s.ai-mbti-main\src\data\phase2_seed.json", 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"Successfully generated {len(data)} content blocks.")
