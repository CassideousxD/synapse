import asyncio
import pytest

from app.core.security import create_access_token


@pytest.mark.asyncio
async def test_note_upload_extracts_concepts_and_deduplicates(client):
    # 1. Register and login teacher
    t_reg = await client.post(
        "/auth/register/teacher",
        json={"name": "Prof Smith", "email": "smith@test.edu", "password": "password123"},
    )
    assert t_reg.status_code == 201
    t_token = t_reg.json()["accessToken"]
    t_headers = {"Authorization": f"Bearer {t_token}"}

    # 2. Create classroom
    c_res = await client.post(
        "/classrooms",
        json={"name": "Data Structures", "subject": "CS", "description": "Core CS course"},
        headers=t_headers,
    )
    assert c_res.status_code == 201
    classroom_id = c_res.json()["id"]

    # 3. Create Note 1 with two concepts
    note1_res = await client.post(
        "/notes",
        json={
            "title": "Trees & Heaps Overview",
            "classroomId": classroom_id,
            "summary": "Introduction to tree structures.",
            "sections": [
                {
                    "heading": "Binary Trees",
                    "body": "A Binary Tree is a hierarchical structure where each node has at most two children.",
                },
                {
                    "heading": "Binary Heaps",
                    "body": "A Binary Heap is a complete binary tree satisfying the heap property.",
                },
            ],
            "published": True,
        },
        headers=t_headers,
    )
    assert note1_res.status_code == 201
    n1_data = note1_res.json()
    assert n1_data["status"] in ("PROCESSING", "READY")
    if n1_data["status"] == "PROCESSING":
        for _ in range(50):
            await asyncio.sleep(0.05)
            r = await client.get(f"/notes/{n1_data['id']}", headers=t_headers)
            if r.json().get("status") == "READY":
                n1_data = r.json()
                break
    assert len(n1_data["conceptIds"]) >= 2
    binary_tree_cid = next(cid for cid in n1_data["conceptIds"] if "binary-tree" in cid or "tree" in cid)

    # 4. Create Note 2 in the SAME classroom mentioning Binary Trees again + a new concept (AVL Trees)
    note2_res = await client.post(
        "/notes",
        json={
            "title": "Balanced Trees",
            "classroomId": classroom_id,
            "summary": "Self-balancing binary trees.",
            "sections": [
                {
                    "heading": "Binary Trees",
                    "body": "Binary Trees can become unbalanced in the worst case.",
                },
                {
                    "heading": "AVL Trees",
                    "body": "An AVL Tree is a self-balancing binary search tree maintaining balance factors.",
                },
            ],
            "published": True,
        },
        headers=t_headers,
    )
    assert note2_res.status_code == 201
    n2_data = note2_res.json()
    assert n2_data["status"] in ("PROCESSING", "READY")
    if n2_data["status"] == "PROCESSING":
        for _ in range(50):
            await asyncio.sleep(0.05)
            r = await client.get(f"/notes/{n2_data['id']}", headers=t_headers)
            if r.json().get("status") == "READY":
                n2_data = r.json()
                break
    # Concept deduplication: binary_tree_cid must be reused in note 2!
    assert binary_tree_cid in n2_data["conceptIds"]

    # 5. Fetch classroom concepts - no duplicate concept nodes
    concepts_res = await client.get(
        f"/classrooms/{classroom_id}/concepts",
        headers=t_headers,
    )
    assert concepts_res.status_code == 200
    concepts = concepts_res.json()
    c_names = [c["name"].lower() for c in concepts]
    assert len(c_names) == len(set(c_names)), "Concepts must be deduplicated by name"
    assert any("binary tree" in name for name in c_names)
    assert any("avl tree" in name for name in c_names)


@pytest.mark.asyncio
async def test_student_knowledge_graph_grows_unassessed_then_assessed(client):
    # 1. Setup teacher and classroom with a note
    t_reg = await client.post(
        "/auth/register/teacher",
        json={"name": "Teacher A", "email": "teach@test.edu", "password": "password123"},
    )
    assert t_reg.status_code == 201
    t_token = t_reg.json()["accessToken"]
    t_headers = {"Authorization": f"Bearer {t_token}"}

    c_res = await client.post(
        "/classrooms",
        json={"name": "Algorithms", "subject": "CS"},
        headers=t_headers,
    )
    classroom = c_res.json()
    join_code = classroom["joinCode"]
    classroom_id = classroom["id"]

    # Teacher uploads note with concepts
    note_res = await client.post(
        "/notes",
        json={
            "title": "Sorting Algorithms",
            "classroomId": classroom_id,
            "summary": "Core comparison sorts.",
            "sections": [
                {
                    "heading": "Quick Sort",
                    "body": "Quick Sort is a divide-and-conquer sorting algorithm with average O(n log n) runtime.",
                },
                {
                    "heading": "Merge Sort",
                    "body": "Merge Sort is a stable divide-and-conquer sorting algorithm with guaranteed O(n log n).",
                },
            ],
            "published": True,
        },
        headers=t_headers,
    )
    assert note_res.status_code == 201
    note_id = note_res.json()["id"]
    for _ in range(50):
        await asyncio.sleep(0.05)
        r = await client.get(f"/notes/{note_id}", headers=t_headers)
        if r.json().get("status") == "READY":
            break

    # 2. Register student and join classroom
    s_reg = await client.post(
        "/auth/register/student",
        json={"name": "Student A", "email": "student@test.edu", "password": "password123"},
    )
    assert s_reg.status_code == 201
    s_token = s_reg.json()["accessToken"]
    s_headers = {"Authorization": f"Bearer {s_token}"}

    # Student joins classroom
    join_res = await client.post(
        "/classrooms/join",
        json={"joinCode": join_code},
        headers=s_headers,
    )
    assert join_res.status_code == 200

    # 3. Verify student's knowledge graph includes new concepts with UNASSESSED status
    mastery_res = await client.get("/analytics/mastery", headers=s_headers)
    assert mastery_res.status_code == 200
    student_mastery = mastery_res.json()

    # All concepts from enrolled classroom must be present
    assert len(student_mastery) >= 2
    for cid, info in student_mastery.items():
        assert info["mastery"] is None, f"Untested concept {cid} must have mastery: None (unassessed)"

    # Student can query enrolled concepts
    enrolled_concepts_res = await client.get("/classrooms/enrolled/concepts", headers=s_headers)
    assert enrolled_concepts_res.status_code == 200
    enrolled_concepts = enrolled_concepts_res.json()
    assert len(enrolled_concepts) >= 2

    # 4. Generate test questions from classroom concepts
    gen_res = await client.post(
        "/tests/generate-questions",
        json={"classroomId": classroom_id, "count": 2},
        headers=t_headers,
    )
    assert gen_res.status_code == 200
    generated_questions = gen_res.json()
    assert len(generated_questions) == 2
    tested_cid = generated_questions[0]["conceptId"]
    assert tested_cid in student_mastery

    # 5. Teacher creates and publishes test using generated questions
    test_res = await client.post(
        "/tests",
        json={
            "title": "Sorting Checkpoint",
            "classroomId": classroom_id,
            "durationMin": 15,
            "due": "Tomorrow",
            "status": "published",
            "conceptIds": [tested_cid],
            "questions": generated_questions,
        },
        headers=t_headers,
    )
    assert test_res.status_code == 201
    test_id = test_res.json()["id"]

    # 6. Student submits answers to the test
    sub_res = await client.post(
        f"/tests/{test_id}/submit",
        json={
            "answers": {
                generated_questions[0]["id"]: generated_questions[0]["answer"],
                generated_questions[1]["id"]: "Wrong Answer",
            }
        },
        headers=s_headers,
    )
    assert sub_res.status_code == 200

    # 7. Student checks mastery again: tested concept is now ASSESSED!
    updated_mastery_res = await client.get("/analytics/mastery", headers=s_headers)
    updated_mastery = updated_mastery_res.json()
    assert updated_mastery[tested_cid]["mastery"] is not None
    assert updated_mastery[tested_cid]["mastery"] > 0
