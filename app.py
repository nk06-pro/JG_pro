from flask import Flask, render_template, request, jsonify
from pymongo import MongoClient
import datetime
import time

app = Flask(__name__)

# MongoDB Atlas 연결 설정 (본인의 URI로 채워주세요!)
client = MongoClient('mongodb+srv://sadpotato9586_db_user:4yBhJp3SiJq6pFgj@guests0.mxic95c.mongodb.net/?appName=guests0')
db = client.dbsparta  # 데이터베이스 이름

@app.route('/')
def home():
    return render_template('index.html')

# 1. 포스트 목록 불러오기 (최신순 정렬: .sort('id', -1))
@app.route('/api/memo', methods=['GET'])
def show_memos():
    memos = list(db.retro_posts.find({}, {'_id': False}).sort('id', -1))
    return jsonify({'result': 'success', 'posts': memos})

# 2. 새 포스트 작성 (POST)
@app.route('/api/memo', methods=['POST'])
def save_memo():
    title_receive = request.form['title_give']
    content_receive = request.form['content_give']
    link_receive = request.form['link_give']
    date_receive = datetime.datetime.now().strftime('%Y. %m. %d')
    
    # 고유 ID 생성 (타임스탬프 활용)
    post_id = str(int(time.time() * 1000))

    doc = {
        'id': post_id,
        'title': title_receive,
        'content': content_receive,
        'link': link_receive,
        'date': date_receive
    }
    
    db.retro_posts.insert_one(doc)
    return jsonify({'result': 'success', 'msg': '블로그에 성공적으로 저장되었습니다!'})

# 3. 포스트 수정 (POST)
@app.route('/api/memo/update', methods=['POST'])
def update_memo():
    post_id = request.form['id_give']
    title_receive = request.form['title_give']
    content_receive = request.form['content_give']
    link_receive = request.form['link_give']

    db.retro_posts.update_one(
        {'id': post_id},
        {
            '$set': {
                'title': title_receive,
                'content': content_receive,
                'link': link_receive
            }
        }
    )
    return jsonify({'result': 'success', 'msg': '포스트가 성공적으로 수정되었습니다!'})

# 4. 개별 포스트 삭제 (POST)
@app.route('/api/memo/delete', methods=['POST'])
def delete_memo():
    post_id = request.form['id_give']
    db.retro_posts.delete_one({'id': post_id})
    return jsonify({'result': 'success', 'msg': '포스트가 삭제되었습니다.'})

# 5. 전체 데이터 초기화 (POST)
@app.route('/api/memo/clear', methods=['POST'])
def clear_memos():
    db.retro_posts.delete_many({})
    return jsonify({'result': 'success', 'msg': '모든 데이터가 초기화되었습니다.'})

if __name__ == '__main__':
    app.run('0.0.0.0', port=5000, debug=True)