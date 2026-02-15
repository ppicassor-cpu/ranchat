import os
import time

# ==========================================
# 설정: 제외할 폴더 및 포함할 파일 확장자
# ==========================================
IGNORED_DIRS = {'node_modules', '.expo', '.git', 'assets', 'android', 'ios', '__pycache__'}
IGNORED_FILES = {'package-lock.json', 'yarn.lock', 'export_code.py', '.gitignore'}
ALLOWED_EXTENSIONS = {'.js', '.jsx', '.ts', '.tsx', '.json'}

def merge_project_files():
    # 1. 파일명에 날짜와 시간 추가 (형식: all_project_code_20240101_123055.txt)
    timestamp = time.strftime("%Y%m%d_%H%M%S")
    output_filename = f"all_project_code_{timestamp}.txt"

    # 스크립트가 있는 현재 폴더 기준
    current_dir = os.path.dirname(os.path.abspath(__file__))
    output_path = os.path.join(current_dir, output_filename)
    
    # 본인 파일(소스코드 추출 스크립트)도 결과물에 포함되지 않도록 제외 목록에 추가
    IGNORED_FILES.add(output_filename)

    print("=" * 50)
    print(f"📂 [N빵] React Native 소스코드 변환기")
    print("=" * 50)
    print(f"📍 대상 폴더: {current_dir}")
    print(f"🚫 제외 폴더: {', '.join(IGNORED_DIRS)}")

    count = 0
    try:
        with open(output_path, 'w', encoding='utf-8') as outfile:
            # 헤더 작성
            outfile.write("==================================================\n")
            outfile.write("   N_BBANG PROJECT SOURCE CODE\n")
            outfile.write(f"   Exported at: {time.strftime('%Y-%m-%d %H:%M:%S')}\n")
            outfile.write("==================================================\n\n")

            # 하위 폴더 탐색 (os.walk)
            for root, dirs, files in os.walk(current_dir):
                # 제외할 폴더 건너뛰기
                dirs[:] = [d for d in dirs if d not in IGNORED_DIRS]
                
                for file in files:
                    if file in IGNORED_FILES:
                        continue
                    
                    _, ext = os.path.splitext(file)
                    if ext.lower() not in ALLOWED_EXTENSIONS:
                        continue

                    file_path = os.path.join(root, file)
                    relative_path = os.path.relpath(file_path, current_dir)
                    
                    try:
                        with open(file_path, 'r', encoding='utf-8') as infile:
                            content = infile.read()
                            
                            # 파일 구분선 및 내용 기록
                            outfile.write(f"\n{'='*80}\n")
                            outfile.write(f" FILE: {relative_path}\n")
                            outfile.write(f"{'='*80}\n\n")
                            outfile.write(content)
                            outfile.write("\n")
                            
                            print(f"✅ 추가됨: {relative_path}")
                            count += 1
                    except Exception as e:
                        print(f"⚠️ 읽기 실패 (건너뜀): {relative_path} - {e}")
        
        print("\n" + "=" * 50)
        print(f"🎉 변환 완료! 총 {count}개의 핵심 파일을 합쳤습니다.")
        print(f"📄 저장된 파일: {output_filename}")
        print("=" * 50)

    except Exception as e:
        print(f"\n❌ 치명적인 오류 발생: {e}")
        # 오류가 났을 때는 바로 꺼지면 내용을 못 보니 5초 대기
        time.sleep(5)

if __name__ == "__main__":
    merge_project_files()
    
    # 2. 엔터 입력 대기 제거 및 자동 종료 (2초 후)
    print("\n[안내] 작업이 완료되었습니다. 2초 후 자동으로 창이 닫힙니다...")
    time.sleep(2)